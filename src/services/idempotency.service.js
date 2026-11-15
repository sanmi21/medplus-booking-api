// Makes POST /bookings safe to retry. The same Idempotency-Key with the same
// body always gets the same answer and never creates a second booking.

import crypto from 'node:crypto';
import { pool } from '../db.js';
import { HttpError } from '../lib/httpError.js';

export const MAX_KEY_LENGTH = 255;

// Outcomes worth remembering: a retry should get the same final answer.
// Anything else (500s, and 429s in Level 5) is NOT stored, so a later retry
// gets a fresh chance to succeed.
const STORED_STATUSES = new Set([201, 400, 404, 409]);

// The same JSON with its keys in alphabetical order, at every level.
// {"a":1,"b":2} and {"b":2,"a":1} are the same body, so they get the same hash.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

function hashBody(body) {
  return crypto.createHash('sha256').update(canonicalJson(body)).digest('hex');
}

// Runs `work(client)` at most once per key, and returns { status, body }.
// `work` must do all its database work through `client`, so that the booking
// and the stored answer are saved together in ONE transaction.
export async function runOnce(key, body, work) {
  if (key.length > MAX_KEY_LENGTH) {
    throw new HttpError(400, 'idempotency key is too long');
  }
  const requestHash = hashBody(body);
  const client = await pool.connect();

  try {
    await client.query('begin');

    // Claim the key. If another request has claimed the same key and hasn't
    // finished yet, Postgres makes this statement WAIT until that request
    // commits or rolls back. So two identical retries can never run at once.
    const claimed = await client.query(
      `insert into idempotency_keys (key, request_hash)
       values ($1, $2)
       on conflict (key) do nothing
       returning key`,
      [key, requestHash],
    );

    let outcome;
    if (claimed.rows.length === 0) {
      // The key was used before: replay its answer (or refuse a different body).
      outcome = await replay(client, key, requestHash);
    } else {
      // First time we see this key: do the real work and remember the answer.
      outcome = await capture(() => work(client));
      if (STORED_STATUSES.has(outcome.status)) {
        await client.query(
          'update idempotency_keys set status_code = $2, response = $3 where key = $1',
          [key, outcome.status, outcome.body],
        );
      } else {
        // Don't remember this answer; free the key for a later retry.
        await client.query('delete from idempotency_keys where key = $1', [key]);
      }
    }

    await client.query('commit');
    return outcome;
  } catch (err) {
    // Unexpected failure: undo everything, including the key claim.
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function replay(client, key, requestHash) {
  const result = await client.query(
    'select request_hash, status_code, response from idempotency_keys where key = $1',
    [key],
  );
  const saved = result.rows[0];
  if (saved.request_hash !== requestHash) {
    return { status: 422, body: { error: 'idempotency key reused with a different body' } };
  }
  if (saved.status_code === null) {
    // Shouldn't happen (we only commit finished rows), but never return nothing.
    return { status: 409, body: { error: 'request with this idempotency key is still in progress' } };
  }
  return { status: saved.status_code, body: saved.response };
}

// Runs the booking and turns the result into { status, body }, including our
// own expected errors (400, 404, 409...). Unexpected errors are re-thrown.
async function capture(run) {
  try {
    return { status: 201, body: await run() };
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status, body: { error: err.message }, headers: err.headers };
    }
    throw err;
  }
}

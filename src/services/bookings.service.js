// Business rules for bookings. Knows nothing about Express: it takes plain
// values, returns plain objects, and throws HttpError for client mistakes.

import { pool, query, withTransaction } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { isUuid, isPlainObject, isNonEmptyString, isValidEmail, parseLimit } from '../lib/validate.js';
import { bookingToJson } from '../lib/serialize.js';
import { runOnce } from './idempotency.service.js';
import { checkRateLimit, emailForRateLimit } from './rateLimit.service.js';

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254; // the longest email address the standards allow

// Checks the booking request body (steps 1–3) and returns cleaned-up values.
// Throws a 400 for the first problem found.
function checkNewBooking(body) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'body must be a json object');
  }
  for (const field of ['slot_id', 'name', 'email']) {
    if (!isNonEmptyString(body[field])) {
      throw new HttpError(400, `${field} is required`);
    }
  }

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();

  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, 'name is too long');
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new HttpError(400, 'email is too long');
  }
  if (!isValidEmail(email)) {
    throw new HttpError(400, 'email is invalid');
  }

  // slot_id is an id, not text a person typed, so it is used exactly as sent.
  return { slotId: body.slot_id, name, email };
}

// Entry point for POST /bookings (API and web page). Returns { status, body },
// plus `headers` when a request with a key is rate limited (Retry-After).
//
// The order is: idempotency replay → rate limit → validation → booking.
// A replay returns the stored answer without counting as a new attempt.
export async function placeBooking(body, idempotencyKey) {
  const email = emailForRateLimit(body);

  if (!idempotencyKey) {
    // The attempt is counted in its own small transaction, which commits
    // before booking. So a booking that then fails (400/404/409) still counts.
    await withTransaction((client) => checkRateLimit(client, email));
    return { status: 201, body: await createBooking(body) };
  }

  // With a key, everything runs in runOnce's transaction. Failed bookings
  // don't throw out of it (their answer is stored), so the attempt still counts.
  return runOnce(idempotencyKey, body, async (client) => {
    await checkRateLimit(client, email);
    return createBooking(body, client);
  });
}

// `db` is the pool by default, or a transaction's client when called from
// runOnce, so the booking and its idempotency record commit together.
export async function createBooking(body, db = pool) {
  const { slotId, name, email } = checkNewBooking(body);

  // Step 4 and 5: the slot must exist and must not have started.
  // We ask the database for the time (now()) so every server instance uses
  // the same clock as the stored slot times.
  const slotResult = await db.query(
    'select start_at <= now() as has_started from slots where id = $1',
    [slotId],
  );
  if (slotResult.rows.length === 0) {
    throw new HttpError(404, 'slot not found');
  }
  if (slotResult.rows[0].has_started) {
    throw new HttpError(400, 'slot has already started');
  }

  // Step 6: save the booking — but only if nobody else holds the slot.
  //
  // We do NOT check "is the slot free?" and then insert: two requests could
  // both see "free" before either inserts. Instead we just try the insert and
  // let the unique index (one_confirmed_booking_per_slot) decide. Postgres
  // lets exactly one win; the others hit the conflict and insert nothing.
  //
  // ON CONFLICT ... DO NOTHING means a loser gets 0 rows back instead of an
  // error. That matters for idempotency: an error inside a transaction would
  // abort it, and we couldn't save the 409 answer for retries.
  let result;
  try {
    result = await db.query(
      `insert into bookings (slot_id, name, email)
       values ($1, $2, $3)
       on conflict (slot_id) where status = 'confirmed' do nothing
       returning *`,
      [slotId, name, email],
    );
  } catch (err) {
    // Safety net: if the index ever reports the clash as an error instead
    // (code 23505 = unique violation), it still means "already booked".
    if (err.code === '23505') {
      throw new HttpError(409, 'slot already booked');
    }
    throw err;
  }

  if (result.rows.length === 0) {
    throw new HttpError(409, 'slot already booked');
  }
  return bookingToJson(result.rows[0]);
}

export async function getBooking(id) {
  if (!isUuid(id)) {
    throw new HttpError(404, 'booking not found');
  }
  const result = await query('select * from bookings where id = $1', [id]);
  if (result.rows.length === 0) {
    throw new HttpError(404, 'booking not found');
  }
  return bookingToJson(result.rows[0]);
}

export async function cancelBooking(id) {
  if (!isUuid(id)) {
    throw new HttpError(404, 'booking not found');
  }

  // One atomic statement: it only changes a booking that is still confirmed.
  // If two cancel requests race, only one gets the row back; the other sees
  // 0 rows and reports "already cancelled" below.
  const result = await query(
    `update bookings set status = 'cancelled'
     where id = $1 and status = 'confirmed'
     returning *`,
    [id],
  );
  if (result.rows.length === 1) {
    return bookingToJson(result.rows[0]);
  }

  // Nothing changed: either the booking doesn't exist, or it was already cancelled.
  const existing = await query('select 1 from bookings where id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new HttpError(404, 'booking not found');
  }
  throw new HttpError(409, 'booking already cancelled');
}

// ---- Listing a person's bookings (cursor pagination) ----------------------

// The cursor is the `seq` of the last booking on the page, wrapped in
// base64url so clients treat it as an opaque token rather than a number.
function encodeCursor(seq) {
  return Buffer.from(String(seq)).toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new HttpError(400, 'invalid cursor');
  }
  const seq = Buffer.from(cursor, 'base64url').toString();
  if (!/^\d{1,18}$/.test(seq)) {
    throw new HttpError(400, 'invalid cursor');
  }
  return seq;
}

export async function listBookings({ email, limit, cursor }) {
  if (!isNonEmptyString(email)) {
    throw new HttpError(400, 'email is required');
  }
  const pageSize = parseLimit(limit);
  const afterSeq = cursor === undefined ? '0' : decodeCursor(cursor);

  // Keyset pagination: "the next rows after this seq", not "skip N rows".
  // It stays correct even if new bookings arrive while someone is paging.
  // We fetch one extra row only to learn whether another page exists.
  const result = await query(
    `select * from bookings
     where email = $1 and seq > $2::bigint
     order by seq
     limit $3`,
    [email.trim().toLowerCase(), afterSeq, pageSize + 1],
  );

  const hasMore = result.rows.length > pageSize;
  const rows = result.rows.slice(0, pageSize);
  return {
    bookings: rows.map(bookingToJson),
    next_cursor: hasMore ? encodeCursor(rows[rows.length - 1].seq) : null,
  };
}

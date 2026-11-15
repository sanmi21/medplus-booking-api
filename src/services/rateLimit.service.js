// Stops booking spam: at most 5 attempts per email in any 60 seconds,
// failed attempts included. The 6th gets 429 with a Retry-After header.

import { HttpError } from '../lib/httpError.js';
import { isPlainObject, isNonEmptyString } from '../lib/validate.js';

export const MAX_ATTEMPTS = 5;
export const WINDOW_SECONDS = 60;

// The email an attempt counts against: trimmed and lower-cased, so
// "ADA@x.com " and "ada@x.com" share one limit. A request with no usable
// email returns null: it will fail validation (400) and isn't counted.
export function emailForRateLimit(body) {
  if (!isPlainObject(body) || !isNonEmptyString(body.email)) {
    return null;
  }
  return body.email.trim().toLowerCase();
}

// Counts this attempt, or throws 429 if the email has used up its window.
// Must run inside a transaction (`db` is that transaction's client).
export async function checkRateLimit(db, email) {
  if (email === null) {
    return;
  }

  // Lock this email (only this email) until the transaction ends. Without
  // it, 10 simultaneous requests could all count "4 so far" and all get in.
  // With it, they take turns, so each one sees the true count.
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);

  // Housekeeping: forget this email's attempts that are older than the window.
  await db.query(
    `delete from booking_attempts
     where email = $1 and attempted_at <= clock_timestamp() - make_interval(secs => $2)`,
    [email, WINDOW_SECONDS],
  );

  // A sliding window: "the last 60 seconds", measured from right now — not
  // "this calendar minute", which would let 10 attempts through around :59/:00.
  // clock_timestamp() is the real current time; now() would be the time the
  // transaction started, which can be earlier if we waited for the lock.
  const result = await db.query(
    `select count(*)::int as attempts,
            extract(epoch from min(attempted_at) + make_interval(secs => $2) - clock_timestamp()) as seconds_left
     from booking_attempts
     where email = $1 and attempted_at > clock_timestamp() - make_interval(secs => $2)`,
    [email, WINDOW_SECONDS],
  );
  const { attempts, seconds_left } = result.rows[0];

  if (attempts >= MAX_ATTEMPTS) {
    // Wait until the oldest attempt leaves the window. Whole seconds, at least 1.
    // A rejected attempt is not recorded, so waiting it out always works.
    const retryAfter = Math.max(1, Math.ceil(Number(seconds_left)));
    throw new HttpError(429, 'too many attempts', { 'Retry-After': String(retryAfter) });
  }

  await db.query(
    'insert into booking_attempts (email, attempted_at) values ($1, clock_timestamp())',
    [email],
  );
}

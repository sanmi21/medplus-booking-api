// Business rules for bookings. Knows nothing about Express: it takes plain
// values, returns plain objects, and throws HttpError for client mistakes.

import { query } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { isUuid, isPlainObject, isNonEmptyString, isValidEmail } from '../lib/validate.js';
import { bookingToJson } from '../lib/serialize.js';

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

export async function createBooking(body) {
  const { slotId, name, email } = checkNewBooking(body);

  // Step 4 and 5: the slot must exist and must not have started.
  // We ask the database for the time (now()) so every server instance uses
  // the same clock as the stored slot times.
  const slotResult = await query(
    'select start_at <= now() as has_started from slots where id = $1',
    [slotId],
  );
  if (slotResult.rows.length === 0) {
    throw new HttpError(404, 'slot not found');
  }
  if (slotResult.rows[0].has_started) {
    throw new HttpError(400, 'slot has already started');
  }

  // Step 6: save the booking.
  const result = await query(
    `insert into bookings (slot_id, name, email)
     values ($1, $2, $3)
     returning *`,
    [slotId, name, email],
  );
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

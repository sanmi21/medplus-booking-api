// Business rules for bookings. Knows nothing about Express: it takes plain
// values, returns plain objects, and throws HttpError for client mistakes.

import { query } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { isUuid } from '../lib/validate.js';
import { bookingToJson } from '../lib/serialize.js';

export async function createBooking(body) {
  const { slot_id, name, email } = body ?? {};

  const result = await query(
    `insert into bookings (slot_id, name, email)
     values ($1, $2, $3)
     returning *`,
    [slot_id, name, email],
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

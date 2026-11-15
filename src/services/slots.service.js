// Business rules for slots: replacing them all (/reset) and listing them.

import { query, withTransaction } from '../db.js';
import { HttpError } from '../lib/httpError.js';
import { isNonEmptyString, isValidDate } from '../lib/validate.js';
import { slotToJson } from '../lib/serialize.js';

// Checks the whole /reset body before touching the database, so a bad
// request changes nothing.
function checkResetBody(body) {
  if (!body || !Array.isArray(body.slots)) {
    throw new HttpError(400, 'slots must be an array');
  }
  const seenIds = new Set();
  for (const slot of body.slots) {
    if (!slot || typeof slot !== 'object') {
      throw new HttpError(400, 'each slot must be an object');
    }
    if (!isNonEmptyString(slot.id) || !isNonEmptyString(slot.provider)) {
      throw new HttpError(400, 'each slot needs an id and a provider');
    }
    if (!isValidDate(slot.start) || !isValidDate(slot.end)) {
      throw new HttpError(400, 'each slot needs a valid start and end');
    }
    if (seenIds.has(slot.id)) {
      throw new HttpError(400, 'duplicate slot id');
    }
    seenIds.add(slot.id);
  }
  return body.slots;
}

export async function resetSlots(body) {
  const slots = checkResetBody(body);

  // One transaction: either everything is replaced, or nothing changes.
  await withTransaction(async (client) => {
    await client.query('delete from booking_attempts');
    await client.query('delete from idempotency_keys');
    await client.query('delete from bookings');
    await client.query('delete from slots');

    if (slots.length > 0) {
      // Insert every slot in one statement: unnest() turns the arrays into rows.
      await client.query(
        `insert into slots (id, provider, start_at, end_at, start_raw, end_raw)
         select * from unnest($1::text[], $2::text[], $3::timestamptz[], $4::timestamptz[], $5::text[], $6::text[])`,
        [
          slots.map((s) => s.id),
          slots.map((s) => s.provider),
          slots.map((s) => new Date(s.start).toISOString()),
          slots.map((s) => new Date(s.end).toISOString()),
          slots.map((s) => s.start),
          slots.map((s) => s.end),
        ],
      );
    }
  });
}

export async function listSlots(provider) {
  // "available" is worked out on every read, never stored, so it can never
  // disagree with the bookings table.
  const result = await query(
    `select s.*,
            not exists (
              select 1 from bookings b
              where b.slot_id = s.id and b.status = 'confirmed'
            ) as available
     from slots s
     where ($1::text is null or s.provider = $1)
     order by s.start_at, s.id`,
    [typeof provider === 'string' ? provider : null],
  );
  return result.rows.map(slotToJson);
}

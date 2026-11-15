// Level 4: a retried request never creates a duplicate booking, and a person
// can page through their bookings.
//
// Every email here makes at most 5 booking attempts, so these tests keep
// passing once Level 5's limit (5 attempts per email per minute) is added.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { api, reset, makeSlot, uniqueEmail } from './helpers.js';

function bookWithKey(key, body) {
  return api('POST', '/bookings', { body, headers: { 'Idempotency-Key': key } });
}

function listFor(email, params = '') {
  return api('GET', `/bookings?email=${encodeURIComponent(email)}${params}`);
}

// ---- Idempotency ----------------------------------------------------------

test('same key + same body returns the same booking and creates only one', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const key = crypto.randomUUID();
  const body = { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() };

  const first = await bookWithKey(key, body);
  const retry = await bookWithKey(key, body);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body);

  const list = await listFor(body.email);
  assert.equal(list.body.bookings.length, 1);
});

test('key order in the body does not matter (same body, same answer)', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const key = crypto.randomUUID();
  const email = uniqueEmail();
  const first = await bookWithKey(key, { slot_id: 's1', name: 'Ada Obi', email });
  const retry = await api('POST', '/bookings', {
    rawBody: JSON.stringify({ email, name: 'Ada Obi', slot_id: 's1' }),
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.id, first.body.id);
});

test('10 simultaneous requests with the same key create exactly one booking', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const key = crypto.randomUUID();
  const body = { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() };

  const results = await Promise.all(Array.from({ length: 10 }, () => bookWithKey(key, body)));
  assert.deepEqual(results.map((r) => r.status), Array(10).fill(201));
  const ids = new Set(results.map((r) => r.body.id));
  assert.equal(ids.size, 1, 'every response has the same booking id');

  const list = await listFor(body.email);
  assert.equal(list.body.bookings.length, 1);
});

test('same key + different body returns 422', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24), makeSlot('s2', 'Dr Ade', 25)]);
  const key = crypto.randomUUID();
  const email = uniqueEmail();
  await bookWithKey(key, { slot_id: 's1', name: 'Ada Obi', email });

  const different = await bookWithKey(key, { slot_id: 's2', name: 'Ada Obi', email });
  assert.equal(different.status, 422);
  assert.deepEqual(different.body, { error: 'idempotency key reused with a different body' });

  // And it didn't book s2.
  const slots = await api('GET', '/slots');
  assert.equal(slots.body.slots.find((s) => s.id === 's2').available, true);
});

test('failed answers are replayed too (400, 404, 409), with the same status', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);

  const badKey = crypto.randomUUID();
  const badBody = { slot_id: 's1', name: 'Ada Obi', email: 'not-an-email' };
  assert.equal((await bookWithKey(badKey, badBody)).status, 400);
  const badRetry = await bookWithKey(badKey, badBody);
  assert.equal(badRetry.status, 400);
  assert.deepEqual(badRetry.body, { error: 'email is invalid' });

  const missingKey = crypto.randomUUID();
  const missingBody = { slot_id: 'nope', name: 'Ada Obi', email: uniqueEmail() };
  assert.equal((await bookWithKey(missingKey, missingBody)).status, 404);
  assert.equal((await bookWithKey(missingKey, missingBody)).status, 404);

  await bookWithKey(crypto.randomUUID(), { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() });
  const takenKey = crypto.randomUUID();
  const takenBody = { slot_id: 's1', name: 'Bo Eze', email: uniqueEmail() };
  assert.equal((await bookWithKey(takenKey, takenBody)).status, 409);
  const takenRetry = await bookWithKey(takenKey, takenBody);
  assert.equal(takenRetry.status, 409);
  assert.deepEqual(takenRetry.body, { error: 'slot already booked' });
});

test('a replayed 201 stays the same even after the booking is cancelled', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const key = crypto.randomUUID();
  const body = { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() };
  const first = await bookWithKey(key, body);
  await api('DELETE', `/bookings/${first.body.id}`);

  // The retry must not book the (now free) slot again.
  const retry = await bookWithKey(key, body);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.id, first.body.id);
  const list = await listFor(body.email);
  assert.equal(list.body.bookings.length, 1);
});

test('different keys are separate requests', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const body = { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() };
  const first = await bookWithKey(crypto.randomUUID(), body);
  const second = await bookWithKey(crypto.randomUUID(), body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
});

test('without a key, behaviour is unchanged', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const body = { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() };
  assert.equal((await api('POST', '/bookings', { body })).status, 201);
  assert.equal((await api('POST', '/bookings', { body })).status, 409);
});

test('/reset forgets idempotency keys', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const key = crypto.randomUUID();
  const email = uniqueEmail();
  await bookWithKey(key, { slot_id: 's1', name: 'Ada Obi', email });

  await reset([makeSlot('s9', 'Dr Ade', 24)]);
  const reused = await bookWithKey(key, { slot_id: 's9', name: 'Ada Obi', email });
  assert.equal(reused.status, 201);
});

test('an over-long Idempotency-Key returns 400', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const res = await bookWithKey('k'.repeat(256), { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() });
  assert.equal(res.status, 400);
});

// ---- Listing a person's bookings ------------------------------------------

test('pages through 5 bookings with limit=2: 2, 2, 1, then next_cursor null', async () => {
  const slots = Array.from({ length: 5 }, (_, i) => makeSlot(`s${i}`, 'Dr Ade', 24 + i));
  await reset([...slots, makeSlot('other', 'Dr Ade', 40)]);
  const email = uniqueEmail();
  const createdIds = [];
  for (const slot of slots) {
    const res = await api('POST', '/bookings', { body: { slot_id: slot.id, name: 'Ada Obi', email } });
    createdIds.push(res.body.id);
  }
  // Someone else's booking must not show up.
  await api('POST', '/bookings', { body: { slot_id: 'other', name: 'Bo Eze', email: uniqueEmail() } });

  const pageSizes = [];
  const seenIds = [];
  let cursor = null;
  do {
    const res = await listFor(email, `&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['bookings', 'next_cursor']);
    pageSizes.push(res.body.bookings.length);
    seenIds.push(...res.body.bookings.map((b) => b.id));
    cursor = res.body.next_cursor;
  } while (cursor !== null);

  assert.deepEqual(pageSizes, [2, 2, 1]);
  assert.deepEqual(seenIds, createdIds, 'oldest first, no gaps, no repeats');
});

test('default limit is 10, the email match ignores case, and cancelled bookings are included', async () => {
  const slots = Array.from({ length: 3 }, (_, i) => makeSlot(`s${i}`, 'Dr Ade', 24 + i));
  await reset(slots);
  const email = uniqueEmail();
  const created = [];
  for (const slot of slots) {
    created.push((await api('POST', '/bookings', { body: { slot_id: slot.id, name: 'Ada Obi', email } })).body);
  }
  await api('DELETE', `/bookings/${created[0].id}`);

  const res = await listFor(`  ${email.toUpperCase()} `);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.bookings.map((b) => b.id), created.map((b) => b.id));
  assert.deepEqual(res.body.bookings.map((b) => b.status), ['cancelled', 'confirmed', 'confirmed']);
  assert.equal(res.body.next_cursor, null);
});

test('a person with no bookings gets an empty list', async () => {
  const res = await listFor(uniqueEmail());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { bookings: [], next_cursor: null });
});

test('bad limits return 400', async () => {
  const email = uniqueEmail();
  for (const limit of ['0', '51', 'abc', '2.5', '-1', '', '1e1', '10abc']) {
    const res = await listFor(email, `&limit=${encodeURIComponent(limit)}`);
    assert.equal(res.status, 400, `limit=${limit}`);
    assert.equal(typeof res.body.error, 'string');
  }
  for (const limit of ['1', '50']) {
    assert.equal((await listFor(email, `&limit=${limit}`)).status, 200, `limit=${limit}`);
  }
});

test('missing email or a bad cursor returns 400', async () => {
  assert.equal((await api('GET', '/bookings')).status, 400);
  assert.equal((await api('GET', '/bookings?email=')).status, 400);

  const email = uniqueEmail();
  const notNumber = Buffer.from('abc').toString('base64url');
  for (const cursor of ['!!!', notNumber, '']) {
    const res = await listFor(email, `&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(res.status, 400, `cursor=${cursor}`);
  }
});

test('GET /bookings needs the API key', async () => {
  const res = await api('GET', `/bookings?email=${encodeURIComponent(uniqueEmail())}`, { apiKey: null });
  assert.equal(res.status, 401);
});

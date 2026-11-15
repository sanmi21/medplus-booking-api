// Level 1: list slots, book one, look up a booking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, reset, makeSlot, uniqueEmail } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT_KEYS = ['available', 'end', 'id', 'provider', 'start'];
const BOOKING_KEYS = ['created_at', 'email', 'id', 'name', 'slot_id', 'status'];

test('POST /reset returns 200 and replaces all slots', async () => {
  const res = await reset([makeSlot('s1', 'Dr Ade', 24)]);
  assert.equal(res.status, 200);

  await reset([makeSlot('x1', 'Dr Bello', 24)]);
  const slots = await api('GET', '/slots');
  assert.deepEqual(slots.body.slots.map((s) => s.id), ['x1']);
});

test('GET /slots returns the exact shape, earliest start first', async () => {
  await reset([
    makeSlot('late', 'Dr Ade', 48),
    makeSlot('early', 'Dr Bello', 24),
    makeSlot('middle', 'Dr Ade', 36),
  ]);
  const res = await api('GET', '/slots');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), ['slots']);
  assert.deepEqual(res.body.slots.map((s) => s.id), ['early', 'middle', 'late']);
  for (const slot of res.body.slots) {
    assert.deepEqual(Object.keys(slot).sort(), SLOT_KEYS);
    assert.equal(slot.available, true);
  }
});

test('GET /slots sorts by real time, not by the text of the date', async () => {
  // 10:00 at +02:00 is 08:00 UTC, so it comes before 09:00Z even though the
  // string "2030-01-01T10..." sorts after "2030-01-01T09...".
  await reset([
    { id: 'b', provider: 'Dr Ade', start: '2030-01-01T09:00:00Z', end: '2030-01-01T09:30:00Z' },
    { id: 'a', provider: 'Dr Ade', start: '2030-01-01T10:00:00+02:00', end: '2030-01-01T10:30:00+02:00' },
  ]);
  const res = await api('GET', '/slots');
  assert.deepEqual(res.body.slots.map((s) => s.id), ['a', 'b']);
});

test('GET /slots echoes start and end exactly as sent', async () => {
  const slot = { id: 's1', provider: 'Dr Ade', start: '2030-01-01T10:00:00+01:00', end: '2030-01-01T10:30:00+01:00' };
  await reset([slot]);
  const res = await api('GET', '/slots');
  assert.deepEqual(res.body.slots[0], { ...slot, available: true });
});

test('GET /slots?provider= filters by exact provider name', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24), makeSlot('s2', 'Dr Bello', 25), makeSlot('s3', 'Dr Ade', 26)]);
  const res = await api('GET', '/slots?provider=' + encodeURIComponent('Dr Ade'));
  assert.deepEqual(res.body.slots.map((s) => s.id), ['s1', 's3']);

  const partial = await api('GET', '/slots?provider=Dr');
  assert.deepEqual(partial.body.slots, []);
});

test('/reset accepts past slots, and they show as available', async () => {
  await reset([makeSlot('past', 'Dr Ade', -24)]);
  const res = await api('GET', '/slots');
  assert.equal(res.body.slots[0].id, 'past');
  assert.equal(res.body.slots[0].available, true);
});

test('POST /bookings returns 201 with the booking', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const email = uniqueEmail();
  const res = await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email } });

  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(res.body).sort(), BOOKING_KEYS);
  assert.match(res.body.id, UUID);
  assert.equal(res.body.slot_id, 's1');
  assert.equal(res.body.name, 'Ada Obi');
  assert.equal(res.body.email, email);
  assert.equal(res.body.status, 'confirmed');
  // created_at is an ISO 8601 UTC string close to now
  assert.match(res.body.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  assert.ok(Math.abs(Date.parse(res.body.created_at) - Date.now()) < 60_000);
});

test('a booked slot shows available: false', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24), makeSlot('s2', 'Dr Ade', 25)]);
  await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() } });
  const res = await api('GET', '/slots');
  const byId = Object.fromEntries(res.body.slots.map((s) => [s.id, s.available]));
  assert.deepEqual(byId, { s1: false, s2: true });
});

test('GET /bookings/:id returns the same booking', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const created = await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() } });
  const res = await api('GET', `/bookings/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, created.body);
});

test('GET /bookings/:id returns 404 JSON for unknown or malformed ids', async () => {
  const unknown = await api('GET', '/bookings/00000000-0000-4000-8000-000000000000');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'booking not found' });

  const junk = await api('GET', '/bookings/not-a-uuid');
  assert.equal(junk.status, 404);
  assert.deepEqual(junk.body, { error: 'booking not found' });
});

test('/reset deletes every booking', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const created = await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() } });
  await reset([makeSlot('s1', 'Dr Ade', 24)]);

  const res = await api('GET', `/bookings/${created.body.id}`);
  assert.equal(res.status, 404);
  const slots = await api('GET', '/slots');
  assert.equal(slots.body.slots[0].available, true);
});

test('/reset with a bad body returns 400 and changes nothing', async () => {
  await reset([makeSlot('keep', 'Dr Ade', 24)]);
  const badBodies = [
    {},
    { slots: 'nope' },
    { slots: [{ id: 's1', provider: 'Dr Ade', start: 'not a date', end: '2030-01-01T10:30:00Z' }] },
    { slots: [{ id: 's1', provider: 'Dr Ade', end: '2030-01-01T10:30:00Z' }] },
    { slots: [makeSlot('dup', 'Dr Ade', 24), makeSlot('dup', 'Dr Ade', 25)] },
  ];
  for (const body of badBodies) {
    const res = await api('POST', '/reset', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof res.body.error, 'string');
  }
  const slots = await api('GET', '/slots');
  assert.deepEqual(slots.body.slots.map((s) => s.id), ['keep']);
});

test('unknown routes and malformed JSON return JSON errors, not HTML', async () => {
  const unknown = await api('GET', '/nope');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'not found' });

  const badJson = await api('POST', '/bookings', { rawBody: '{"slot_id": ' });
  assert.equal(badJson.status, 400);
  assert.deepEqual(badJson.body, { error: 'invalid json' });
});

test('responses do not reveal the framework', async () => {
  const res = await api('GET', '/slots');
  assert.equal(res.headers.get('x-powered-by'), null);
});

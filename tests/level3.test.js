// Level 3: two people can never book the same slot, and bookings can be cancelled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, reset, makeSlot, uniqueEmail } from './helpers.js';

function book(slotId, email = uniqueEmail()) {
  return api('POST', '/bookings', { body: { slot_id: slotId, name: 'Ada Obi', email } });
}

async function slotAvailability(slotId) {
  const res = await api('GET', '/slots');
  return res.body.slots.find((s) => s.id === slotId).available;
}

test('a second booking for the same slot returns 409', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const first = await book('s1');
  assert.equal(first.status, 201);

  const second = await book('s1');
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { error: 'slot already booked' });
});

test('20 simultaneous bookings for one slot: exactly one wins', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);

  // Fire all 20 at once, each from a different person.
  const results = await Promise.all(Array.from({ length: 20 }, () => book('s1')));
  const statuses = results.map((r) => r.status);

  assert.equal(statuses.filter((s) => s === 201).length, 1, `statuses: ${statuses}`);
  assert.equal(statuses.filter((s) => s === 409).length, 19, `statuses: ${statuses}`);
  for (const r of results.filter((r) => r.status === 409)) {
    assert.deepEqual(r.body, { error: 'slot already booked' });
  }
  assert.equal(await slotAvailability('s1'), false);

  // Then: cancel, and the slot can be booked again.
  const winner = results.find((r) => r.status === 201).body;
  const cancelled = await api('DELETE', `/bookings/${winner.id}`);
  assert.equal(cancelled.status, 200);
  assert.equal(await slotAvailability('s1'), true);

  const rebooked = await book('s1');
  assert.equal(rebooked.status, 201);
  assert.equal(await slotAvailability('s1'), false);
});

test('simultaneous bookings for different slots all succeed', async () => {
  const slots = Array.from({ length: 5 }, (_, i) => makeSlot(`s${i}`, 'Dr Ade', 24 + i));
  await reset(slots);
  const results = await Promise.all(slots.map((s) => book(s.id)));
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201]);
});

test('DELETE /bookings/:id cancels and returns the booking', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const created = await book('s1');

  const res = await api('DELETE', `/bookings/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...created.body, status: 'cancelled' });

  // The change is saved, not just reported.
  const fetched = await api('GET', `/bookings/${created.body.id}`);
  assert.equal(fetched.body.status, 'cancelled');
});

test('cancelling twice returns 409 the second time', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const created = await book('s1');
  await api('DELETE', `/bookings/${created.body.id}`);

  const again = await api('DELETE', `/bookings/${created.body.id}`);
  assert.equal(again.status, 409);
  assert.deepEqual(again.body, { error: 'booking already cancelled' });
});

test('cancelling an old booking does not free a slot someone else has rebooked', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const first = await book('s1');
  await api('DELETE', `/bookings/${first.body.id}`);
  const second = await book('s1');
  assert.equal(second.status, 201);

  const cancelOldAgain = await api('DELETE', `/bookings/${first.body.id}`);
  assert.equal(cancelOldAgain.status, 409);
  assert.equal(await slotAvailability('s1'), false);

  const third = await book('s1');
  assert.equal(third.status, 409);
});

test('simultaneous cancels of one booking: exactly one succeeds', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const created = await book('s1');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => api('DELETE', `/bookings/${created.body.id}`)),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409, 409, 409]);
});

test('DELETE /bookings/:id returns 404 for unknown or malformed ids', async () => {
  const unknown = await api('DELETE', '/bookings/00000000-0000-4000-8000-000000000000');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'booking not found' });

  const junk = await api('DELETE', '/bookings/not-a-uuid');
  assert.equal(junk.status, 404);
});

test('DELETE /bookings/:id needs the API key', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const created = await book('s1');
  const res = await api('DELETE', `/bookings/${created.body.id}`, { apiKey: null });
  assert.equal(res.status, 401);
  const fetched = await api('GET', `/bookings/${created.body.id}`);
  assert.equal(fetched.body.status, 'confirmed');
});

test('the 409 check comes after validation (bad input still gets 400)', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  await book('s1');
  const res = await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: 'bad' } });
  assert.equal(res.status, 400);
});

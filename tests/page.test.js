// The web page and its /app/* routes: no API key needed, same rules as the API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, reset, makeSlot, uniqueEmail, API_KEY } from './helpers.js';

// All /app requests are sent WITHOUT the API key, like the browser does.
function app(method, path, options = {}) {
  return api(method, '/app' + path, { ...options, apiKey: null });
}

test('the page is served without an API key and does not contain the key', async () => {
  const res = await api('GET', '/', { apiKey: null });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.body, /MedPlus Clinic/);
  assert.ok(API_KEY.length > 0 && !res.body.includes(API_KEY), 'API key must not be in the page');
});

test('GET /app/slots lists slots without an API key', async () => {
  await reset([makeSlot('s2', 'Dr Bello', 48), makeSlot('s1', 'Dr Ade', 24)]);
  const res = await app('GET', '/slots');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.slots.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(Object.keys(res.body.slots[0]).sort(), ['available', 'end', 'id', 'provider', 'start']);
});

test('POST /app/bookings books a slot, and GET /app/bookings/:id shows it', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const email = uniqueEmail();
  const created = await app('POST', '/bookings', { body: { slot_id: 's1', name: ' Ada Obi ', email } });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'confirmed');
  assert.equal(created.body.name, 'Ada Obi');

  const fetched = await app('GET', `/bookings/${created.body.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body, created.body);

  // The API sees the same booking.
  const viaApi = await api('GET', `/bookings/${created.body.id}`);
  assert.deepEqual(viaApi.body, created.body);
});

test('/app/bookings follows the same rules as the API (400, 404, 409)', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24), makeSlot('past', 'Dr Ade', -24)]);

  const bad = await app('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: 'bad' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: 'email is invalid' });

  const missing = await app('POST', '/bookings', { body: { slot_id: 'nope', name: 'Ada Obi', email: uniqueEmail() } });
  assert.equal(missing.status, 404);

  const started = await app('POST', '/bookings', { body: { slot_id: 'past', name: 'Ada Obi', email: uniqueEmail() } });
  assert.equal(started.status, 400);

  // A slot booked through the API can't be booked again through the page.
  await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() } });
  const taken = await app('POST', '/bookings', { body: { slot_id: 's1', name: 'Bo Eze', email: uniqueEmail() } });
  assert.equal(taken.status, 409);
});

test('there is no /app route for reset, and unknown /app paths are JSON 404s', async () => {
  const resetAttempt = await app('POST', '/reset', { body: { slots: [] } });
  assert.equal(resetAttempt.status, 404);
  assert.deepEqual(resetAttempt.body, { error: 'not found' });

  const cancelAttempt = await app('DELETE', '/bookings/00000000-0000-4000-8000-000000000000');
  assert.equal(cancelAttempt.status, 404);
});

test('/app routes return JSON errors for malformed JSON', async () => {
  const res = await app('POST', '/bookings', { rawBody: '{"slot_id":' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid json' });
});

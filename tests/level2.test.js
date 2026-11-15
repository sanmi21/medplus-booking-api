// Level 2: only requests with the API key get in, and bad bookings are turned away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, reset, makeSlot, uniqueEmail, API_KEY } from './helpers.js';

// A wrong key of the same length, to prove the comparison is about content.
const WRONG_SAME_LENGTH = API_KEY.slice(0, -1) + (API_KEY.endsWith('x') ? 'y' : 'x');

const ENDPOINTS = [
  ['POST', '/reset', { slots: [] }],
  ['GET', '/slots'],
  ['POST', '/bookings', { slot_id: 's1', name: 'Ada Obi', email: 'ada@example.com' }],
  ['GET', '/bookings/00000000-0000-4000-8000-000000000000'],
  ['GET', '/no-such-route'],
];

test('every endpoint returns 401 JSON without the API key', async () => {
  for (const [method, path, body] of ENDPOINTS) {
    const res = await api(method, path, { body, apiKey: null });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(typeof res.body.error, 'string');
  }
});

test('every endpoint returns 401 with a wrong API key', async () => {
  for (const wrongKey of ['wrong', '', WRONG_SAME_LENGTH, API_KEY + 'x']) {
    for (const [method, path, body] of ENDPOINTS) {
      const res = await api(method, path, { body, apiKey: wrongKey });
      assert.equal(res.status, 401, `${method} ${path} with key "${wrongKey}"`);
    }
  }
});

test('a request without a key gets 401 even if its JSON is broken', async () => {
  const res = await api('POST', '/bookings', { rawBody: '{"slot_id":', apiKey: null });
  assert.equal(res.status, 401);
});

test('/reset without a key changes nothing', async () => {
  await reset([makeSlot('keep', 'Dr Ade', 24)]);
  await api('POST', '/reset', { body: { slots: [] }, apiKey: null });
  const res = await api('GET', '/slots');
  assert.deepEqual(res.body.slots.map((s) => s.id), ['keep']);
});

test('POST /bookings returns 400 for a body that is not a JSON object', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  for (const rawBody of ['[]', '"text"', '42', 'null']) {
    const res = await api('POST', '/bookings', { rawBody });
    assert.equal(res.status, 400, rawBody);
    assert.equal(typeof res.body.error, 'string');
  }
  const noBody = await api('POST', '/bookings');
  assert.equal(noBody.status, 400);
});

test('POST /bookings returns 400 for missing, empty or non-string fields', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const badValues = [undefined, '', '   ', null, 42, true, ['s1'], { a: 1 }];

  for (const field of ['slot_id', 'name', 'email']) {
    for (const value of badValues) {
      // A fresh email each time: these are many attempts, and Level 5 allows
      // only 5 per email per minute.
      const good = { slot_id: 's1', name: 'Ada Obi', email: uniqueEmail() };
      const body = { ...good, [field]: value };
      const res = await api('POST', '/bookings', { body });
      assert.equal(res.status, 400, `${field} = ${JSON.stringify(value)}`);
      assert.equal(typeof res.body.error, 'string');
    }
  }
});

test('POST /bookings returns 400 for invalid emails', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const badEmails = ['plainaddress', 'no-at-sign.com', 'ada@', '@example.com', 'ada@example', 'ada @example.com', 'ada@@example.com'];
  for (const email of badEmails) {
    const res = await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email } });
    assert.equal(res.status, 400, email);
    assert.deepEqual(res.body, { error: 'email is invalid' });
  }
});

test('POST /bookings returns 400 for a name or email that is too long', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const longName = await api('POST', '/bookings', {
    body: { slot_id: 's1', name: 'a'.repeat(201), email: uniqueEmail() },
  });
  assert.equal(longName.status, 400);

  const longEmail = await api('POST', '/bookings', {
    body: { slot_id: 's1', name: 'Ada Obi', email: 'a'.repeat(250) + '@example.com' },
  });
  assert.equal(longEmail.status, 400);
});

test('POST /bookings returns 404 when the slot does not exist', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const res = await api('POST', '/bookings', { body: { slot_id: 'nope', name: 'Ada Obi', email: uniqueEmail() } });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'slot not found' });
});

test('POST /bookings returns 400 when the slot has already started', async () => {
  await reset([
    makeSlot('yesterday', 'Dr Ade', -24),
    makeSlot('just-started', 'Dr Ade', -0.05), // started 3 minutes ago, still running
  ]);
  for (const slotId of ['yesterday', 'just-started']) {
    const res = await api('POST', '/bookings', { body: { slot_id: slotId, name: 'Ada Obi', email: uniqueEmail() } });
    assert.equal(res.status, 400, slotId);
    assert.deepEqual(res.body, { error: 'slot has already started' });
  }
});

test('an invalid field is reported before an unknown slot (400 before 404)', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const res = await api('POST', '/bookings', { body: { slot_id: 'nope', name: 'Ada Obi', email: 'bad' } });
  assert.equal(res.status, 400);
});

test('name and email are trimmed, and email is stored in lower case', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  const email = uniqueEmail();
  const res = await api('POST', '/bookings', {
    body: { slot_id: 's1', name: '  Ada Obi  ', email: `  ${email.toUpperCase()}  ` },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Ada Obi');
  assert.equal(res.body.email, email);

  const fetched = await api('GET', `/bookings/${res.body.id}`);
  assert.equal(fetched.body.name, 'Ada Obi');
  assert.equal(fetched.body.email, email);
});

test('rejected bookings leave the slot available', async () => {
  await reset([makeSlot('s1', 'Dr Ade', 24)]);
  await api('POST', '/bookings', { body: { slot_id: 's1', name: '', email: uniqueEmail() } });
  await api('POST', '/bookings', { body: { slot_id: 's1', name: 'Ada Obi', email: 'bad' } });
  const res = await api('GET', '/slots');
  assert.equal(res.body.slots[0].available, true);
});

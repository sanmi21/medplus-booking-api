// Level 5: at most 5 booking attempts per email per minute (failed ones
// included). The 6th gets 429 with a Retry-After header in whole seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { api, reset, makeSlot, uniqueEmail } from './helpers.js';

function slots(count) {
  return Array.from({ length: count }, (_, i) => makeSlot(`s${i}`, 'Dr Ade', 24 + i));
}

function book(slotId, email, headers = {}) {
  return api('POST', '/bookings', { body: { slot_id: slotId, name: 'Ada Obi', email }, headers });
}

function assertRateLimited(res) {
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { error: 'too many attempts' });
  const retryAfter = res.headers.get('retry-after');
  assert.match(retryAfter ?? '', /^\d+$/, 'Retry-After is a whole number of seconds');
  const seconds = Number(retryAfter);
  assert.ok(seconds >= 1 && seconds <= 60, `Retry-After ${seconds} should be 1..60`);
  return seconds;
}

test('5 attempts pass, the 6th gets 429 with Retry-After', async () => {
  await reset(slots(6));
  const email = uniqueEmail();
  for (let i = 0; i < 5; i++) {
    assert.equal((await book(`s${i}`, email)).status, 201, `attempt ${i + 1}`);
  }
  assertRateLimited(await book('s5', email));
});

test('failed attempts count too', async () => {
  await reset(slots(1));
  const email = uniqueEmail();
  for (let i = 0; i < 5; i++) {
    assert.equal((await book('nope', email)).status, 404);
  }
  assertRateLimited(await book('s0', email));
});

test('other emails are not affected', async () => {
  await reset(slots(7));
  const spammer = uniqueEmail();
  for (let i = 0; i < 5; i++) await book('nope', spammer);
  assertRateLimited(await book('s0', spammer));

  assert.equal((await book('s0', uniqueEmail())).status, 201);
});

test('the same email in different case or with spaces shares one limit', async () => {
  await reset(slots(6));
  const email = uniqueEmail();
  const variants = [email, email.toUpperCase(), `  ${email}  `, email, email.toUpperCase()];
  for (let i = 0; i < 5; i++) {
    assert.equal((await book(`s${i}`, variants[i])).status, 201);
  }
  assertRateLimited(await book('s5', ` ${email.toUpperCase()}`));
});

test('requests without an email get 400 and are not counted', async () => {
  await reset(slots(1));
  for (let i = 0; i < 7; i++) {
    const res = await api('POST', '/bookings', { body: { slot_id: 's0', name: 'Ada Obi' } });
    assert.equal(res.status, 400);
  }
});

test('10 simultaneous attempts for one email: exactly 5 get in', async () => {
  await reset(slots(10));
  const email = uniqueEmail();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => book(`s${i}`, email)));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 5, `statuses: ${statuses}`);
  assert.equal(statuses.filter((s) => s === 429).length, 5, `statuses: ${statuses}`);
  for (const r of results.filter((r) => r.status === 429)) assertRateLimited(r);
});

test('idempotent replays are not counted as new attempts', async () => {
  await reset(slots(6));
  const email = uniqueEmail();
  const key = crypto.randomUUID();
  const first = await book('s0', email, { 'Idempotency-Key': key });
  assert.equal(first.status, 201);

  // Five replays of the same request: same answer, not counted.
  for (let i = 0; i < 5; i++) {
    const replay = await book('s0', email, { 'Idempotency-Key': key });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id);
  }

  // So 4 more real attempts still fit (2nd–5th), and the 6th is refused.
  for (let i = 1; i < 5; i++) {
    assert.equal((await book(`s${i}`, email)).status, 201, `attempt ${i + 1}`);
  }
  assertRateLimited(await book('s5', email));
});

test('a 429 with an Idempotency-Key is not stored, and includes Retry-After', async () => {
  await reset(slots(6));
  const email = uniqueEmail();
  for (let i = 0; i < 5; i++) await book(`s${i}`, email);

  const key = crypto.randomUUID();
  assertRateLimited(await book('s5', email, { 'Idempotency-Key': key }));
  // Still limited on retry (and not a 422): the key was released, not saved.
  assertRateLimited(await book('s5', email, { 'Idempotency-Key': key }));
});

test('the web page route shares the same limit', async () => {
  await reset(slots(6));
  const email = uniqueEmail();
  for (let i = 0; i < 5; i++) await book(`s${i}`, email);
  const res = await api('POST', '/app/bookings', {
    body: { slot_id: 's5', name: 'Ada Obi', email },
    apiKey: null,
  });
  assertRateLimited(res);
});

test('after waiting Retry-After seconds, the email can book again (sliding window)', { timeout: 90_000 }, async () => {
  await reset(slots(7));
  const email = uniqueEmail();
  for (let i = 0; i < 5; i++) await book(`s${i}`, email);
  const seconds = assertRateLimited(await book('s5', email));

  await sleep(seconds * 1000 + 500);
  assert.equal((await book('s6', email)).status, 201);
});

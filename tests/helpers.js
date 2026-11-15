// Shared test helpers. The tests talk to a running server over HTTP, so the
// same tests work locally and against the live Vercel URL.

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const API_KEY = process.env.API_KEY || '';

// Sends a request and returns { status, headers, body }.
// `body` is parsed JSON when the response is JSON, otherwise raw text.
export async function api(method, path, { body, headers = {}, apiKey = API_KEY, rawBody } = {}) {
  const allHeaders = { ...headers };
  if (apiKey !== null) allHeaders['X-API-Key'] = apiKey;

  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
    allHeaders['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    allHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(BASE_URL + path, { method, headers: allHeaders, body: payload });
  const text = await response.text();
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  return {
    status: response.status,
    headers: response.headers,
    body: isJson ? JSON.parse(text) : text,
  };
}

// Replaces all slots. Fails the test straight away if the reset doesn't work.
export async function reset(slots) {
  const res = await api('POST', '/reset', { body: { slots } });
  if (res.status !== 200) {
    throw new Error(`reset failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

// An ISO time string `hours` from now (negative = in the past), on the minute.
export function hoursFromNow(hours) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setUTCSeconds(0, 0);
  return date.toISOString().replace('.000Z', 'Z');
}

// A 30-minute slot starting `hours` from now.
export function makeSlot(id, provider, hours) {
  return { id, provider, start: hoursFromNow(hours), end: hoursFromNow(hours + 0.5) };
}

// A different email every call, so tests never share a person (matters for
// rate limiting in Level 5).
let counter = 0;
export function uniqueEmail() {
  counter += 1;
  return `test-${Date.now()}-${process.pid}-${counter}@example.com`;
}

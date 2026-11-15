// Small input-checking helpers shared by the services.

import { HttpError } from './httpError.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Booking ids are UUIDs. Checking first means a junk id like "abc" gives a
// clean 404 instead of a Postgres "invalid uuid" error (which would be a 500).
export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Deliberately simple: something@something.something with no spaces.
// Stricter checks reject real addresses more often than they catch typos.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(value);
}

// True if the value is a plain {...} object (not null, not an array).
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The ?limit= for listing bookings: a whole number from 1 to 50, default 10.
// Anything else ("0", "51", "abc", "2.5", "-1", "") is a 400.
export function parseLimit(value) {
  if (value === undefined) {
    return 10;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, 'limit must be a whole number from 1 to 50');
  }
  const limit = Number(value);
  if (limit < 1 || limit > 50) {
    throw new HttpError(400, 'limit must be a whole number from 1 to 50');
  }
  return limit;
}

// True if JavaScript can turn the string into a real point in time.
export function isValidDate(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

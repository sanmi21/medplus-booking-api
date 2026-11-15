// Small input-checking helpers shared by the services.

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

// True if JavaScript can turn the string into a real point in time.
export function isValidDate(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

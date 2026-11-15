// Lets a request through only if its X-API-Key header matches API_KEY.
// Missing or wrong key → 401.

import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/httpError.js';

// Hashing both sides first gives two buffers of the same length, which
// timingSafeEqual requires. It also means we never compare raw secrets.
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest();
}

const expectedHash = sha256(config.apiKey);

export function requireApiKey(req, res, next) {
  const given = req.get('X-API-Key');
  // timingSafeEqual takes the same time whether the first or last character
  // is wrong, so an attacker can't guess the key one character at a time.
  if (!given || !crypto.timingSafeEqual(sha256(given), expectedHash)) {
    return next(new HttpError(401, 'invalid or missing api key'));
  }
  next();
}

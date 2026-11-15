// Makes sure every failure leaves as JSON {"error": "..."}, never an HTML page.

import { HttpError } from '../lib/httpError.js';

// Runs when no route matched.
export function notFound(req, res) {
  res.status(404).json({ error: 'not found' });
}

// Express calls this for any thrown error (Express 5 also catches errors
// from async route handlers, so routes don't need try/catch).
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Our own, expected errors: send the status and message as-is.
  if (err instanceof HttpError) {
    if (err.headers) res.set(err.headers);
    return res.status(err.status).json({ error: err.message });
  }

  // The JSON body couldn't be parsed.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid json' });
  }

  // Other request problems from Express's body parser (e.g. body too large).
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.expose ? err.message : 'bad request' });
  }

  // Anything else is a bug or an outage. Log the details for us; never send
  // database errors to the client.
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
}

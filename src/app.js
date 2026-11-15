// Builds the Express app: middleware → routes → error handling.
// Exported (not started) so Vercel can run it as a function.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { slotsRouter } from './routes/slots.routes.js';
import { bookingsRouter } from './routes/bookings.routes.js';
import { pageRouter } from './routes/page.routes.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { requireApiKey } from './middleware/apiKey.js';

const app = express();
const parseJson = express.json({ limit: '100kb' });

app.disable('x-powered-by');

// The web page. On Vercel, files in public/ are served by Vercel's CDN before
// a request reaches Express (and express.static is ignored), so this line is
// only used when running locally.
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// Routes for the web page: no API key, so the key never reaches the browser.
// They end with their own 404, so unknown /app paths don't ask for a key.
app.use('/app', parseJson, pageRouter, notFound);

// The API. The key is checked before anything else, even before the body is
// parsed, so a request without a key always gets 401. Every route below this
// line (including unknown ones) needs the key.
app.use(requireApiKey);
app.use(parseJson);

app.use(slotsRouter);
app.use(bookingsRouter);

// These two must come last.
app.use(notFound);
app.use(errorHandler);

export default app;

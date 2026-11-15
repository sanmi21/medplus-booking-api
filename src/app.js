// Builds the Express app: middleware → routes → error handling.
// Exported (not started) so Vercel can run it as a function.

import express from 'express';
import { slotsRouter } from './routes/slots.routes.js';
import { bookingsRouter } from './routes/bookings.routes.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { requireApiKey } from './middleware/apiKey.js';

const app = express();

app.disable('x-powered-by');

// The key is checked before anything else, even before the body is parsed,
// so a request without a key always gets 401. Every route below this line
// (including unknown ones) needs the key.
app.use(requireApiKey);
app.use(express.json({ limit: '100kb' }));

app.use(slotsRouter);
app.use(bookingsRouter);

// These two must come last.
app.use(notFound);
app.use(errorHandler);

export default app;

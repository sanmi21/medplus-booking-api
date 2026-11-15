// Builds the Express app: middleware → routes → error handling.
// Exported (not started) so Vercel can run it as a function.

import express from 'express';
import { slotsRouter } from './routes/slots.routes.js';
import { bookingsRouter } from './routes/bookings.routes.js';
import { notFound, errorHandler } from './middleware/errors.js';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use(slotsRouter);
app.use(bookingsRouter);

// These two must come last.
app.use(notFound);
app.use(errorHandler);

export default app;

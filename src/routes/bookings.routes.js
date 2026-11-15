// HTTP routes for bookings. Thin: read the request, call the service, reply.

import { Router } from 'express';
import { placeBooking, getBooking, cancelBooking, listBookings } from '../services/bookings.service.js';

export const bookingsRouter = Router();

bookingsRouter.post('/bookings', async (req, res) => {
  // placeBooking returns the status too, because an idempotent replay must
  // repeat the original status code (201, 400, 404 or 409).
  const { status, body, headers } = await placeBooking(req.body, req.get('Idempotency-Key'));
  if (headers) res.set(headers); // e.g. Retry-After on a 429
  res.status(status).json(body);
});

bookingsRouter.get('/bookings', async (req, res) => {
  const page = await listBookings({
    email: req.query.email,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  res.status(200).json(page);
});

bookingsRouter.get('/bookings/:id', async (req, res) => {
  const booking = await getBooking(req.params.id);
  res.status(200).json(booking);
});

bookingsRouter.delete('/bookings/:id', async (req, res) => {
  const booking = await cancelBooking(req.params.id);
  res.status(200).json(booking);
});

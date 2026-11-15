// Routes used by the booking web page (public/index.html). They need no API
// key, so the key never has to be sent to the browser. They call the SAME
// service functions as the API routes, so the page can't behave differently.
// There is deliberately no /app route for /reset, and none that lists
// bookings by email (an email alone must never reveal someone's bookings).

import { Router } from 'express';
import { listSlots } from '../services/slots.service.js';
import {
  placeBooking,
  getBooking,
  cancelBooking,
  findBookingByReferenceAndEmail,
} from '../services/bookings.service.js';

export const pageRouter = Router();

pageRouter.get('/slots', async (req, res) => {
  const slots = await listSlots();
  res.status(200).json({ slots });
});

pageRouter.post('/bookings', async (req, res) => {
  // The page sends a fresh Idempotency-Key per attempt, so a double-tap or a
  // network retry can't create two bookings.
  const { status, body, headers } = await placeBooking(req.body, req.get('Idempotency-Key'));
  if (headers) res.set(headers); // e.g. Retry-After on a 429
  res.status(status).json(body);
});

// With ?email= ("Find a booking"), the email must match the booking.
// Without it, the reference alone is enough (used for "My bookings" and the
// confirmation link, where the browser already has the reference).
pageRouter.get('/bookings/:id', async (req, res) => {
  const booking = req.query.email === undefined
    ? await getBooking(req.params.id)
    : await findBookingByReferenceAndEmail(req.params.id, req.query.email);
  res.status(200).json(booking);
});

pageRouter.delete('/bookings/:id', async (req, res) => {
  const booking = await cancelBooking(req.params.id);
  res.status(200).json(booking);
});

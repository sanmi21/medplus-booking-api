// Routes used by the booking web page (public/index.html). They need no API
// key, so the key never has to be sent to the browser. They call the SAME
// service functions as the API routes, so the page can't behave differently.
// There is deliberately no /app route for /reset.

import { Router } from 'express';
import { listSlots } from '../services/slots.service.js';
import { createBooking, getBooking } from '../services/bookings.service.js';

export const pageRouter = Router();

pageRouter.get('/slots', async (req, res) => {
  const slots = await listSlots();
  res.status(200).json({ slots });
});

pageRouter.post('/bookings', async (req, res) => {
  const booking = await createBooking(req.body);
  res.status(201).json(booking);
});

pageRouter.get('/bookings/:id', async (req, res) => {
  const booking = await getBooking(req.params.id);
  res.status(200).json(booking);
});

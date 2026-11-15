// HTTP routes for bookings. Thin: read the request, call the service, reply.

import { Router } from 'express';
import { createBooking, getBooking, cancelBooking } from '../services/bookings.service.js';

export const bookingsRouter = Router();

bookingsRouter.post('/bookings', async (req, res) => {
  const booking = await createBooking(req.body);
  res.status(201).json(booking);
});

bookingsRouter.get('/bookings/:id', async (req, res) => {
  const booking = await getBooking(req.params.id);
  res.status(200).json(booking);
});

bookingsRouter.delete('/bookings/:id', async (req, res) => {
  const booking = await cancelBooking(req.params.id);
  res.status(200).json(booking);
});

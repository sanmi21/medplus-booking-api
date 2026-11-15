// HTTP routes for slots. Thin: read the request, call the service, reply.

import { Router } from 'express';
import { resetSlots, listSlots } from '../services/slots.service.js';

export const slotsRouter = Router();

slotsRouter.post('/reset', async (req, res) => {
  await resetSlots(req.body);
  res.status(200).json({ ok: true });
});

slotsRouter.get('/slots', async (req, res) => {
  const slots = await listSlots(req.query.provider);
  res.status(200).json({ slots });
});

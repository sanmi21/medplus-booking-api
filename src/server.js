// Local development only: loads .env and starts the server on a port.
// On Vercel, the exported app in app.js is used instead.

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// Imported after dotenv so config.js can see the variables from .env.
const { default: app } = await import('./app.js');
const { config } = await import('./config.js');

app.listen(config.port, () => {
  console.log(`Booking API listening on http://localhost:${config.port}`);
});

// The one database connection pool for the whole app.
// Created once at module level so every request (and every warm Vercel
// function instance) reuses it instead of opening new connections.

import pg from 'pg';
import { config } from './config.js';

// SSL is always on for the real database (Neon). The only exception is a
// database on this computer, which is used for local testing.
const host = new URL(config.databaseUrl).hostname;
const isLocalDatabase = host === 'localhost' || host === '127.0.0.1';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Small on purpose: many function instances may run at once, and each has
  // its own pool. Neon's pooled URL (PgBouncer) shares the real connections.
  max: 3,
  ssl: isLocalDatabase ? false : true,
});

// Without this, a dropped idle connection would crash the whole process.
pool.on('error', (err) => {
  console.error('database pool error', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

// Runs `work(client)` inside BEGIN/COMMIT. If anything throws, everything
// is rolled back, so the database is never left half-changed.
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

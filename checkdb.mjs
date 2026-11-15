import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: [info] } = await client.query('select now() as time, current_database() as db');
console.log('✅ Connected to', info.db, 'at', info.time);

const { rows: tables } = await client.query(
  "select table_name from information_schema.tables where table_schema = 'public'"
);
console.log('Tables:', tables.map((t) => t.table_name).join(', ') || '(none yet — run schema.sql)');

const { rows: indexes } = await client.query(
  "select indexname from pg_indexes where tablename = 'bookings'"
);
console.log('Booking indexes:', indexes.map((i) => i.indexname).join(', '));

await client.end();
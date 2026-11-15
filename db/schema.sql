-- Database schema for the clinic booking API.
-- Grouped by level. Safe to re-run: every statement uses "if not exists".

-- Level 1 ------------------------------------------------------------------

create table if not exists slots (
  id        text primary key,          -- the checks choose ids like "s1"
  provider  text not null,
  start_at  timestamptz not null,      -- used for sorting and the "already started" check
  end_at    timestamptz not null,
  start_raw text not null,             -- the exact string received; returned unchanged
  end_raw   text not null
);

create table if not exists bookings (
  id         uuid primary key default gen_random_uuid(),
  seq        bigserial,                -- insertion order; used for pagination in Level 4
  slot_id    text not null references slots(id),
  name       text not null,
  email      text not null,
  status     text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Level 3 ------------------------------------------------------------------

-- The referee: at most ONE confirmed booking per slot.
-- The database enforces this itself, so it holds even when many requests
-- arrive at the same moment on different servers.
-- Partial (WHERE status = 'confirmed') so a cancelled booking frees the slot.
create unique index if not exists one_confirmed_booking_per_slot
  on bookings (slot_id) where status = 'confirmed';

-- Level 4 ------------------------------------------------------------------

-- One row per Idempotency-Key. The primary key is what makes retries safe:
-- two requests with the same key can't both insert a row, so the second one
-- waits for the first to finish and then replays its stored answer.
create table if not exists idempotency_keys (
  key          text primary key,
  request_hash text not null,          -- SHA-256 of the request body
  status_code  int,                    -- null only while the first request is running
  response     jsonb,
  created_at   timestamptz not null default now()
);

-- Makes "this person's bookings, oldest first" fast: filter by email, walk by seq.
create index if not exists bookings_email_seq on bookings (email, seq);

-- Level 5 ------------------------------------------------------------------

-- One row per booking attempt, used to allow at most 5 attempts per email in
-- any 60 seconds. Old rows are deleted as we go, so the table stays small.
create table if not exists booking_attempts (
  id           bigserial primary key,
  email        text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists booking_attempts_email_time on booking_attempts (email, attempted_at);

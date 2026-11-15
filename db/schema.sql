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

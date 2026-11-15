# Clinic Booking API

An API that lets patients book clinic appointment slots, plus a simple web page that uses it.
Built for the Koya assessment (Task 1), following the spec at
https://koyaacademy.com/assessment-api.

- **Live URL:** _(add after first deploy)_
- **Levels done:** 1

## Stack

Node.js 20+, Express 5, PostgreSQL on Neon (`pg`, no ORM), deployed on Vercel.

## Running locally

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL`: the Neon **pooled** connection string
   - `API_KEY`: any secret string you choose
3. Run `db/schema.sql` once against the database (Neon SQL editor). It's safe to re-run.
4. `npm run dev`. The API is at http://localhost:3000.

## Tests

The tests call a running server over HTTP, so the same tests check local and live.

```bash
npm test                                   # against http://localhost:3000
BASE_URL=https://your-app.vercel.app npm test   # against the live deployment
```

`API_KEY` is read from `.env` (or the environment). Test files run one at a time,
because each test starts with `/reset`.

## Endpoints

| Method | Path | Level |
|---|---|---|
| POST | `/reset` | 1 |
| GET | `/slots` | 1 |
| POST | `/bookings` | 1 |
| GET | `/bookings/:id` | 1 |

## Design decisions

- **Times.** Slot times are stored twice: as `timestamptz` (a real point in time,
  used for sorting and "has it started?") and as the raw string received. The API
  returns the raw string, so the checks get back exactly what they sent, whatever
  time zone format they used. `created_at` is always returned in UTC ISO 8601.
- **Availability is calculated, not stored.** `available` is worked out on every
  read: a slot is unavailable only while it has a `confirmed` booking. A stored
  flag could drift out of sync with the bookings table; a calculation can't.
- **`/reset` is all-or-nothing.** The whole body is checked first, then bookings
  and slots are replaced in one transaction. A bad request changes nothing.
- **Errors are always JSON.** Services throw `HttpError(status, message)`. One
  error handler turns every error, including unknown routes and malformed JSON,
  into `{"error": "..."}`. Unexpected errors are logged and return a plain 500,
  never database details.
- **One small connection pool.** On Vercel, many copies of the function can run
  at once and each has its own pool, so it's capped at 3 connections and uses
  Neon's pooled URL to share real connections.

## Assumptions where the spec is unclear

- `/reset` responds `200 {"ok": true}` (the spec only says 200).
- `/reset` returns 400 if `slots` isn't an array, a slot is missing a field, a
  date can't be parsed, or two slots share an id.
- Slots with the same start time are ordered by `id`, so the order is always the same.
- A booking id that isn't a valid UUID returns 404 (it can't exist), not 400.

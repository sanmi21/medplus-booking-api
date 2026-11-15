# Clinic Booking API

An API that lets patients book clinic appointment slots, plus a simple web page that uses it.
Built for the Koya assessment (Task 1), following the spec at
https://koyaacademy.com/assessment-api.

- **Live URL:** https://medplus-booking-api.vercel.app (the booking page is at `/`)
- **Levels done:** 1, 2, 3, 4, 5, plus the web page

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
npm test                                                     # against http://localhost:3000
BASE_URL=https://medplus-booking-api.vercel.app npm test     # against the live deployment
```

`API_KEY` is read from `.env` (or the environment) and must match the server's key.
Test files run one at a time, because each test starts with `/reset`. One Level 5
test really waits out the 60-second rate-limit window, so a full run takes over a minute.

## Endpoints

Every endpoint needs the `X-API-Key` header.

| Method | Path | Level |
|---|---|---|
| POST | `/reset` | 1 |
| GET | `/slots` | 1 |
| POST | `/bookings` (optional `Idempotency-Key` header) | 1, 2, 3, 4, 5 |
| GET | `/bookings?email=&limit=&cursor=` | 4 |
| GET | `/bookings/:id` | 1 |
| DELETE | `/bookings/:id` | 3 |

### Web page

`public/index.html` is a single page with plain HTML, CSS and JavaScript (no build
step):

- **Book:** see available slots grouped by day, pick one, enter name and email.
- **Confirmation:** the booking reference is shown prominently, with a Copy button.
- **My bookings:** after each successful booking, its id is saved in this
  browser's `localStorage`. The page loads each saved id and lists provider,
  time and status, with a Cancel button (two-step, so a stray tap can't
  cancel) on confirmed bookings. Ids of bookings that no longer exist are
  forgotten automatically.
- **Find a booking:** booking reference **and** email; shown only if both match.

It calls only these routes, which need **no** API key:

| Method | Path | Same service as |
|---|---|---|
| GET | `/app/slots` | `GET /slots` |
| POST | `/app/bookings` | `POST /bookings` |
| GET | `/app/bookings/:id` | `GET /bookings/:id` |
| GET | `/app/bookings/:id?email=` | as above, but 404 unless the email matches |
| DELETE | `/app/bookings/:id` | `DELETE /bookings/:id` |

There is deliberately no `/app` route for reset, and none that lists bookings
by email: knowing someone's email must never reveal their bookings.

## Design decisions

- **API key checked first.** The key check runs before anything else, even
  before the JSON body is read, so any request without the right key gets 401.
  The comparison uses `crypto.timingSafeEqual` on SHA-256 hashes of both keys:
  it takes the same time however much of the key is right, so the key can't be
  guessed one character at a time. The key lives only in an environment variable.
- **Booking checks run in a fixed order:** body is a JSON object → `slot_id`,
  `name`, `email` are non-empty strings → lengths and email format → slot exists
  (404) → slot hasn't started (400) → save. Cheap checks that need no database
  come first, so bad input never costs a query.
- **No double booking, even at the same instant.** A partial unique index,
  `UNIQUE (slot_id) WHERE status = 'confirmed'`, lets the database itself
  refuse a second confirmed booking for a slot. The insert uses
  `ON CONFLICT ... DO NOTHING RETURNING *`: the winner gets its row back, every
  other request gets 0 rows → 409. We never "check if free, then insert", because
  two requests could both pass the check before either inserts. A Postgres
  unique-violation error (`23505`) is also mapped to 409 as a safety net.
  Tested with 20 simultaneous requests: exactly one 201, nineteen 409s.
- **Cancelling frees the slot automatically.** The index only covers
  `confirmed` rows, so once a booking is `cancelled` the slot can be booked
  again, while the cancelled booking stays on record.
- **Atomic cancel.** One statement:
  `UPDATE ... SET status='cancelled' WHERE id=$1 AND status='confirmed' RETURNING *`.
  If two cancels race, only one gets the row back; the other is told 409
  "already cancelled". Only when nothing changed do we look the booking up, to
  choose between 404 (doesn't exist) and 409 (already cancelled).
- **Idempotent retries.** With an `Idempotency-Key`, everything happens in one
  transaction: (1) claim the key by inserting it into `idempotency_keys`
  (primary key) with a SHA-256 hash of the body; (2) run the booking; (3) save
  the status code and response on the key's row; (4) commit. If a second
  request with the same key arrives while the first is still running, its
  insert **waits** on the first one's uncommitted row, then sees the finished
  answer and replays it. So even 10 simultaneous retries create exactly one
  booking and all get the same id. The same key with a different body hash
  gets 422. The booking and its stored answer commit together, so a crash
  can never leave a booking without its answer or the other way round.
- **Which answers are remembered.** Final outcomes (201, 400, 404, 409) are
  stored, so a retry always gets the same answer, even if the booking was
  cancelled in between. Server errors are not stored: the transaction rolls
  back, the key is released, and a later retry can succeed.
- **Body hash ignores key order.** The body is turned into JSON with its keys
  sorted before hashing, so `{"a":1,"b":2}` and `{"b":2,"a":1}` count as the
  same body.
- **Keyset (cursor) pagination.** Bookings have a `seq` column (insertion
  order). A page is "the next `limit` rows with `seq` greater than the cursor",
  using an index on `(email, seq)`. Unlike `OFFSET`, this never skips or
  repeats a booking when new ones arrive between pages, and stays fast however
  deep you page. We fetch `limit + 1` rows to know if another page exists. The
  cursor is the last `seq`, base64url-encoded so clients treat it as opaque.
- **Rate limiting: 5 attempts per email per sliding 60 seconds.** Each attempt
  is a row in `booking_attempts`. To decide, we count that email's rows from
  the last 60 seconds (measured from *now*, not per calendar minute, which
  would let 10 through around :59/:00). The 6th gets 429 with `Retry-After` =
  seconds until the oldest attempt leaves the window (rounded up, at least 1).
  Rejected attempts aren't recorded, so waiting that long always works.
- **Rate limiting is safe under simultaneous requests.** Before counting, the
  transaction takes a Postgres advisory lock on that email
  (`pg_advisory_xact_lock(hashtextextended(email, 0))`), released at commit.
  Requests for the same email take turns, so 10 simultaneous attempts can't all
  see "4 so far": exactly 5 get in. Other emails use different locks and never wait.
  The database stores the counts, so the limit holds across all Vercel instances.
- **What counts as an attempt.** Every `POST /bookings` (API or web page) with
  a non-empty email, counted on the trimmed, lower-cased email, *before*
  validation, so failed attempts (400/404/409) count too. Without a key, the
  attempt is committed in its own small transaction before booking; with a
  key, it's committed together with the stored answer. Order: API key →
  idempotency replay → rate limit → validation → booking. An idempotent replay
  returns the stored answer and is not a new attempt. A 429 is not stored
  against an idempotency key, so the same key can be retried after waiting.
- **The API key never reaches the browser.** A key in page JavaScript is
  visible to anyone who opens the page, so it wouldn't protect anything. The
  page instead calls `/app/*` routes on our own server, which run the **same
  service functions** as the API routes, so the page and the API can never
  behave differently (validation, 409s, and later rate limiting all apply).
  The page has no way to reset, or to list bookings by email.
- **The booking reference works like a ticket.** Booking ids are random UUIDs
  (122 random bits), so they can't be guessed; whoever holds one can view and
  cancel that booking from the page. "Find a booking" additionally requires
  the email, and a wrong email gets exactly the same 404 as a wrong reference,
  so the response never confirms that a reference exists.
- **`localStorage` is only a convenience.** Reads and writes are wrapped in
  try/catch (storage can be blocked, full, or hold junk), and the page works
  without it; the server stays the source of truth for every booking.
- **The page is safe against injected HTML.** Provider and patient names are
  inserted with `textContent`, never `innerHTML`.
- **Confirmation has its own link** (`/#booking=<id>`), so reloading the page
  still shows it. Booking ids are random UUIDs, so they can't be guessed.
- **"Has the slot started?" uses the database clock** (`start_at <= now()`), so
  every server instance agrees on the time and compares it in UTC.

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
- Unknown routes also need the API key: without it they return 401, with it 404.
- Email format check is deliberately simple: `something@something.something`, no
  spaces. Max lengths: name 200 characters, email 254 (the standard limit).
- `name` and `email` are trimmed and `email` is lower-cased, as the spec says.
  `slot_id` is an id, not typed text, so it is used exactly as sent
  (`" s1"` is a different, unknown slot → 404).
- A field that isn't a string (e.g. a number) counts as invalid → 400.
- A slot that started a moment ago but hasn't ended yet still counts as
  "already started" → 400.
- Validation (400/404) is checked before availability (409): a bad request is
  reported as bad even if the slot is also taken.
- Idempotency keys are global (not per email) and are cleared by `/reset`.
  An empty `Idempotency-Key` header counts as no key; one longer than 255
  characters is a 400.
- `GET /bookings`: `email` is required (400 if missing or empty) and matched
  after trimming and lower-casing; all statuses are listed; a malformed cursor
  is a 400; a person with no bookings gets `{"bookings": [], "next_cursor": null}`.
- The pagination test pages through 5 bookings with `limit=2` (2, 2, 1, then
  `null`) rather than 23 with `limit=10`, because Level 5 allows only 5 booking
  attempts per email per minute, and the tests must keep passing after Level 5.
  The logic tested is the same.
- A request with no usable email (missing, empty or not a string) gets 400 and
  isn't counted: there's no person to count it against.
- The rate limit applies to creating bookings only, as the spec says; reads
  and cancels aren't limited. `/reset` clears all recorded attempts.
- Local testing uses PGlite, which runs every connection in one shared
  session, so simultaneous transactions can interfere there in ways real
  Postgres never allows. The concurrency tests are authoritative only against
  a real Postgres (Neon); locally, all tests pass with a single connection.
- Cancelling a booking whose slot is in the past is allowed (the spec doesn't
  forbid it, and it changes nothing for anyone else).

# MedPlus Clinic Booking

A website and an API for booking a doctor's appointment.
You can see free times, book one, look up your booking, and cancel it.

**Live:** https://medplus-booking-api.vercel.app

Built for the Koya assessment (Task 1). The rules it follows are here:
https://koyaacademy.com/assessment-api

---

## What it can do

1. **List** the appointment times and **book** one.
2. **Say no** to anyone without the secret key, and to bookings with missing or wrong details.
3. **Never let two people book the same time**, even if they click at the exact same moment. Bookings can be **cancelled**.
4. **Never book twice** if the same request is sent again, and show a person's bookings **one page at a time**.
5. **Stop spam:** each email gets at most 5 tries a minute.

---

## Run it on your computer

You need **Node.js 20 or newer** and a **Postgres database** (we use Neon).

1. Install the packages:
   ```bash
   npm install
   ```
2. Copy `.env.example` to a new file called `.env`, and fill in two things:
   - `DATABASE_URL`: your database address (on Neon, use the **pooled** one)
   - `API_KEY`: any secret word you like
3. Open your database's SQL editor and run everything in `db/schema.sql`.
   This creates the tables. It's safe to run again.
4. Start the app:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000 to see the booking page.

Never share or commit your `.env` file. It holds your secrets.

---

## Run the tests

The tests talk to a running copy of the app, so they work on your computer **and** on the live site.

On your computer (start the app first):
```bash
npm test
```

On the live site:
```bash
BASE_URL=https://medplus-booking-api.vercel.app npm test
```

The tests use the `API_KEY` from your `.env`. A full run takes about 3 minutes,
because one test waits a whole minute on purpose.

> ⚠️ **Running the tests wipes the live data.**
> Every test starts with `/reset`, which deletes **all** slots and bookings,
> including any demo slots you set up for people to try.
> After testing, add your demo slots again with `/reset`.

---

## How the main parts work

### 1. The database stops double bookings
The database has one rule (a *unique index*): **a time slot can have only one confirmed booking.**
If two people try to book at the same moment, the database lets exactly one in.
The other gets a "sorry, already booked" answer (409).
We don't "check if it's free, then book", because two people could both pass the check at once.
A cancelled booking doesn't count, so cancelling frees the slot.

### 2. The web page uses `/app`, so the secret key stays secret
The API needs a secret key. If we put the key in the web page, anyone could read it.
So the page talks to special `/app` routes on our server instead. These don't need the key.
They run **the same code** as the API, so the page follows all the same rules.
The page **can't** wipe data, and **can't** list bookings by email.

### 3. The booking reference works like a ticket
Every booking gets a long random reference, like `2ecf887d-4e15-…`. It's far too long to guess.
Whoever has the reference can see and cancel that booking, just like a ticket.
**Find a booking** asks for the reference **and** the email.
If either one is wrong, you get the same "not found" message, so nobody can tell whether a reference is real.
**My bookings** remembers your references in your own browser only.

---

## The secret key and the pages

| Who | Where | Needs the key? |
|---|---|---|
| The assessment checks | `/reset`, `/slots`, `/bookings` | ✅ Yes (`X-API-Key` header) |
| The web page | `/`, and `/app/...` | ❌ No |

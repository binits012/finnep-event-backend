# Migration Runbook — Event custom registration form (Backend / MongoDB)

MongoDB index migration for custom registration forms and guest answers. Run **after** EMS PostgreSQL migration and EMS deploy.

Registration forms are **event-level** for **general admission (non–seat-selection) events** — free or paid. Seat-selection checkout does not expose custom fields in v1. Answers are stored on tickets at checkout/registration time.

**v1 payment scope:** Stripe (`create-payment-intent`, zero-amount checkout) and free register. Paytrail and Nabil are **out of scope** for registration-form validation in this release.

## Pre-conditions

- EMS migration `20260829120000_add_registration_form_to_events.js` applied
- EMS + merchant front deployed (organizers can save `registration_form`)
- MongoDB reachable (`MONGO_URI` / connection env from `.env`)
- Backend can connect (run from app server or CI with same env)

## What this migration does

Script: `scripts/backfill-free-event-registration-form.mjs`

- Sparse index on `events.otherInfo.registrationForm.fields`
- Sparse index on `tickets.ticketInfo.registrationAnswers`
- Idempotent — safe to re-run

**Does not** migrate data. Form schema syncs EMS → Mongo via RabbitMQ when events update. Answers are written at registration time into `ticketInfo.registrationAnswers`.

## Step 1 — Dry run (connection check)

```bash
cd finnep-eventapp-backend
npm ci
node -e "import('./model/dbConnect.js').then(() => console.log('Mongo OK')).catch(e => { console.error(e); process.exit(1); })"
```

## Step 2 — Apply migration

```bash
cd finnep-eventapp-backend
npm run migrate:free-event-registration-form
```

Or directly:

```bash
node scripts/backfill-free-event-registration-form.mjs
```

Expected: log lines confirming index creation (or “already exists”).

## Step 3 — Verify indexes

In `mongosh`:

```javascript
db.events.getIndexes().filter(i => i.name === 'event_registration_form_fields')
db.tickets.getIndexes().filter(i => i.name === 'ticket_registration_answers')
```

## Step 4 — Deploy backend

Deploy build that includes:

- `util/registrationForm.js` validation (free and paid checkout)
- Registration / checkout accepting `registrationAnswers`
- RabbitMQ event handler mapping `registration_form` → `otherInfo.registrationForm`
- `publishTicketCreationEvent` preserving `ticketInfo.registrationAnswers`

## Step 5 — Smoke test

1. Create or edit an event in merchant portal with a custom field (e.g. “Company name”) — free or paid.
2. Open event on storefront → complete checkout/registration with email + custom field.
3. Confirm ticket in Mongo has `ticketInfo.registrationAnswers`.
4. Confirm merchant ticket list shows registration summary; open ticket detail for full answers.
5. Confirm a **seated** event cannot save a registration form in merchant portal (GA-only note).

## Rollback

- Redeploy previous backend version (no data loss).
- Indexes can remain; they are sparse and harmless.
- Events without `registrationForm` continue email-only registration unchanged.

## Related

- EMS runbook: `event-merchant-service/docs/MIGRATION_RUNBOOK_FREE_EVENT_REGISTRATION_FORM.md`
- Storefront runbook: `finnep-eventapp/docs/MIGRATION_RUNBOOK_FREE_EVENT_REGISTRATION_FORM.md`
- Flutter runbook: `finnep_eventapp_client/docs/MIGRATION_RUNBOOK_FREE_EVENT_REGISTRATION_FORM.md`

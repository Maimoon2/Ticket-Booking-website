# ScenePass Ticket Booking

ScenePass is a full-stack movie and concert ticket booking platform built for a software engineering hiring assignment. It includes real PostgreSQL-backed event-seat inventory, transactional seat holds, checkout, QR tickets, role-based organiser/admin tools, and category-specific waitlists with expiring offers.

## Features

- Customer registration/login, event browsing and filtering, live visual seat map, ten-minute holds, simulated checkout, QR tickets, booking history, cancellations, waitlist entries and offers.
- Organiser event creation/editing plus event booking, revenue and occupancy analytics.
- Admin venue CRUD and seat layout management.
- JWT authentication, bcrypt password hashing, server-side CUSTOMER/ORGANISER/ADMIN RBAC.
- PostgreSQL row-level locking for race-safe holds; idempotent background hold/offer expiry.
- Optional Nodemailer SMTP delivery for tickets and waitlist claims. If SMTP is not configured, tickets remain available in-app.

## Architecture

`artifacts/ticket-booking` is the React + Vite frontend. `artifacts/api-server` is the Express REST API. `lib/api-spec/openapi.yaml` is the API contract and generates typed React Query clients in `lib/api-client-react`. `lib/db` owns the Drizzle schema and connects to PostgreSQL. See `system-design.md` for the concurrency, TTL, and waitlist design.

## Setup

1. Provision a PostgreSQL database in Replit and copy the environment values into the environment/secrets panel. Use `.env.example` as the reference. Keep `JWT_SECRET`, `SMTP_PASSWORD`, and database credentials out of source control.
2. Install dependencies with `pnpm install`.
3. Apply the development schema with `pnpm --filter @workspace/db run push`.
4. Seed demo accounts and events with `pnpm --filter @workspace/api-server run seed`.
5. Start the API with the `artifacts/api-server: API Server` workflow and the web app with the `artifacts/ticket-booking: web` workflow.

Demo accounts after seeding:

- Admin: `admin@scenepass.demo` / `AdminPass123!`
- Organiser: `organiser@scenepass.demo` / `OrganiserPass123!`
- Customer: `customer@scenepass.demo` / `CustomerPass123!`

## Environment variables

`DATABASE_URL` is required. `JWT_SECRET` should be a long random value. `HOLD_TTL_MINUTES` controls checkout holds, defaulting to 10. `WAITLIST_OFFER_MINUTES` controls how long a waitlist offer stays claimable, defaulting to 15. `HOLD_SWEEP_INTERVAL_MS` controls cleanup frequency. `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` enable email delivery. `STATIC_DIR` optionally points at the built web app so the API server can serve it in production. Never commit a populated `.env`.

## API

All endpoints are under `/api`: `/auth/register`, `/auth/login`, `/auth/me`; `/events`, `/events/:id`, `/events/:id/seats`, `/events/:id/holds`; `/holds/:id`, `/holds/:id/checkout`; `/bookings`, `/bookings/:id`, `/bookings/:id/cancel`; `/waitlist`, `/waitlist/offers`, `/waitlist/offers/:id/claim`; `/organiser/events`, `/organiser/events/:id/analytics`; `/venues`, `/venues/:id`, `/venues/:id/seats`; and `/dashboard`. The OpenAPI file is the detailed request/response reference. Protected routes use `Authorization: Bearer <JWT>`. Errors use 401/403 for auth, 404 for missing resources, 409 for conflicts, and 410 for expired holds/offers.

## Database model

The schema includes `users`, `venues`, `seats`, `events`, `event_seats`, `seat_holds`, `bookings`, `booking_seats`, `waitlist`, `waitlist_offers`, and `audit_events`. `event_seats` is the critical per-event inventory table.

## Testing

Run `pnpm --filter @workspace/api-server run test` for the integration suite. Tests are skipped unless `TEST_API_URL` points at a running, seeded API, so a plain checkout never fails.

To exercise the full suite (including hold-TTL auto-release and waitlist offer expiry) start the API against a disposable database with short timers:

```
HOLD_TTL_MINUTES=0.05 WAITLIST_OFFER_MINUTES=0.1 HOLD_SWEEP_INTERVAL_MS=2000 \
DATABASE_URL=postgres://... pnpm --filter @workspace/api-server run start
TEST_API_URL=http://localhost:3000/api pnpm --filter @workspace/api-server run test
```

The suite covers: one winner under concurrent holds for the same seat; auto-release of expired holds; sell-out → waitlist join → cancellation-triggered offer → claim → confirmed booking; and an unclaimed offer expiring and passing the seat to the next customer in line. Run `pnpm run typecheck` for the workspace typecheck.

## Deployment

### Docker (any host)

The root `Dockerfile` builds both bundles and produces a single image that serves the API and the web app from one origin. Schema setup is a one-off against the production database:

```
docker build -t scenepass .
DATABASE_URL=postgres://... pnpm --filter @workspace/db run push   # one-off schema push
docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... -e APP_URL=https://your-host scenepass
```

### Render (blueprint included)

`render.yaml` provisions a free Postgres and a Docker web service wired to it via `DATABASE_URL`, with `JWT_SECRET` auto-generated. Deploy from the Render dashboard with "New -> Blueprint". After the first deploy set `APP_URL` to the service URL so waitlist offer emails contain working claim links, then run `pnpm --filter @workspace/db run push` once locally with the rendered connection string to create tables.

### Replit

Use Replit's Publish flow after setting production database and SMTP/JWT environment variables. The artifact workflows already bind to the platform-provided ports and base paths.
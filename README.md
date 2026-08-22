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

`DATABASE_URL` is required. `JWT_SECRET` should be a long random value. `HOLD_TTL_MINUTES` controls checkout holds, defaulting to 10. `HOLD_SWEEP_INTERVAL_MS` controls cleanup frequency. `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` enable email delivery. Never commit a populated `.env`.

## API

All endpoints are under `/api`: `/auth/register`, `/auth/login`, `/auth/me`; `/events`, `/events/:id`, `/events/:id/seats`, `/events/:id/holds`; `/holds/:id`, `/holds/:id/checkout`; `/bookings`, `/bookings/:id`, `/bookings/:id/cancel`; `/waitlist`, `/waitlist/offers`, `/waitlist/offers/:id/claim`; `/organiser/events`, `/organiser/events/:id/analytics`; `/venues`, `/venues/:id`, `/venues/:id/seats`; and `/dashboard`. The OpenAPI file is the detailed request/response reference. Protected routes use `Authorization: Bearer <JWT>`. Errors use 401/403 for auth, 404 for missing resources, 409 for conflicts, and 410 for expired holds/offers.

## Database model

The schema includes `users`, `venues`, `seats`, `events`, `event_seats`, `seat_holds`, `bookings`, `booking_seats`, `waitlist`, `waitlist_offers`, and `audit_events`. `event_seats` is the critical per-event inventory table.

## Testing

Run `pnpm --filter @workspace/api-server run test` for the integration test. Set `TEST_API_URL` to the API base URL with seeded data to execute the concurrent-hold assertion; without it the test is safely skipped. Run `pnpm run typecheck` for the workspace typecheck.

## Deployment

Use Replit's Publish flow after setting production database and SMTP/JWT environment variables. The artifact workflows already bind to the platform-provided ports and base paths; no localhost URL is embedded in the application.
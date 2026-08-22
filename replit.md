# ScenePass

ScenePass is a production-style movie and concert ticket booking platform with real seat inventory, transactional checkout, and role-based operations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ticket-booking/src` — React/Vite customer, organiser, and admin UI.
- `artifacts/api-server/src/routes/tickets.ts` — REST endpoints and booking business logic.
- `lib/db/src/schema/index.ts` — PostgreSQL/Drizzle source-of-truth schema.
- `lib/api-spec/openapi.yaml` — REST contract; generated clients live under `lib/api-client-react` and `lib/api-zod`.
- `system-design.md` — concurrency, hold TTL, and waitlist design.

## Architecture decisions

- Seat availability is stored per event in `event_seats`, never globally on a venue seat.
- Holds and checkout lock rows inside PostgreSQL transactions; a failed multi-seat hold rolls back completely.
- Waitlist offers are durable records and reserve one specific event seat until claim or expiry.
- SMTP is optional for local/demo use; QR tickets remain available in the booking UI when email is disabled.

## Product

Customers can discover events, select seats from a live-polled map, hold and purchase tickets, view QR tickets, cancel bookings, and join category-specific waitlists. Organisers manage events and review sales analytics; admins manage venues and seat layouts.

## User preferences

No project-specific preferences recorded.

## Gotchas

- `DATABASE_URL` is required for the API, and schema setup must run before seed.
- Use `PORT` and `BASE_PATH` when running Vite builds/configs outside the Replit workflows (for example `PORT=5000 BASE_PATH=/ pnpm run build`).
- Do not commit populated `.env` files or SMTP/JWT/database credentials.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

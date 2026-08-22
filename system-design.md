# ScenePass system design

## Seat inventory and holds

Seat geometry belongs to a venue, but availability belongs to a show. `seats` stores the reusable layout and `event_seats` stores one row per event/seat pair, so the same A1 can be booked for one event while remaining available for another. A hold is a durable `seat_holds` record with owner, event, status, and expiry. The default TTL is ten minutes and is configurable with `HOLD_TTL_MINUTES`.

`POST /events/:id/holds` opens a PostgreSQL transaction, expires any stale holds for that event, selects all requested `event_seats` rows with `FOR UPDATE`, and validates the complete request before writing anything. If even one seat is unavailable, the transaction rolls back and returns 409. Otherwise it creates one hold and updates every row to `HELD` in the same transaction. Row locks serialize simultaneous requests for A1; exactly one transaction observes `AVAILABLE`.

## Expiry

A background sweep runs at a configurable interval. It locks expired holds, releases only rows still marked `HELD` and owned by that hold, then marks the hold `EXPIRED`. The conditional update makes the operation idempotent and prevents it from touching a seat that checkout already changed to `BOOKED`. The seat-map endpoint also performs a small stale-row cleanup so a user never waits for the next sweep to see a freed seat.

## Checkout

Checkout locks the hold and its seat rows, verifies ownership, status, and expiry, then inserts a booking and booking-seat rows, marks all seats `BOOKED`, and invalidates the hold before committing. A unique booking reference is generated server-side. QR data is generated from that reference and persisted with the booking. Payment is intentionally simulated for the assignment; a payment provider can be inserted before the booking transaction later.

## Waitlist offers

Waitlists are ordered by `created_at` per event and category. Cancellation releases each booked seat inside a transaction, then locks the first `WAITING` entry and creates a durable `waitlist_offers` record. The seat is changed to `OFFERED` with `offered_to_waitlist_offer_id`, so it cannot be selected by a normal hold or offered to another customer. The offer has a fifteen-minute expiry and the waitlist row becomes `OFFERED`.

The expiry sweep locks pending expired offers, marks the offer `EXPIRED`, moves its waitlist row back to `WAITING`, releases only the specifically offered seat, and immediately tries the next eligible entry. Claiming an offer locks the offer and the event seat, verifies both expiry and the offer-to-seat pointer, then creates a confirmed booking and marks the offer `ACCEPTED`. These conditional checks prevent two workers or users from claiming the same seat.

## Real-time updates

The current client polls the seat-map query while a customer is choosing seats. Polling is the fallback transport and remains correct because every authoritative state transition happens in PostgreSQL. A WebSocket/SSE broadcaster can later subscribe to the same transition service without changing the data model or concurrency guarantees.
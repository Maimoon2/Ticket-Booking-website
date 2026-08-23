import test from "node:test";
import assert from "node:assert/strict";

const api = process.env.TEST_API_URL;

type Json = Record<string, any>;

async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${api}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Json | Json[]) : null };
}

async function register(name: string, role?: string) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const result = await request("/auth/register", { method: "POST", body: { name, email, password: "ConcurrentPass123!", ...(role ? { role } : {}) } });
  assert.equal(result.status, 201, `register ${name} failed`);
  return (result.data as Json).token as string;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, stepMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

let cachedEventId: string | null = null;
let waitlistContext: { eventId: string; w2Token: string; w2Offer: Json } | null = null;

async function freshEventId() {
  if (cachedEventId) return cachedEventId;
  const organiser = await register("E2E Organiser", "ORGANISER");
  const venues = await request("/venues", { token: organiser });
  assert.equal(venues.status, 200, "organiser must be able to list venues (run the seed first)");
  const venueId = (venues.data as Json[])[0]?.id;
  assert.ok(venueId, "seeded venue required");
  const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const created = await request("/events", {
    method: "POST",
    token: organiser,
    body: { title: `E2E Hold Test ${Date.now()}`, category: "MOVIE", description: "Integration test event.", startsAt, venueId, premiumPrice: 30, standardPrice: 20 },
  });
  assert.equal(created.status, 201, "event creation failed");
  cachedEventId = (created.data as Json).id as string;
  return cachedEventId;
}

type SeatRow = { id: string; status: string; category: string };

async function seats(eventId: string) {
  const result = await request(`/events/${eventId}/seats`);
  assert.equal(result.status, 200);
  return result.data as SeatRow[];
}

async function holdAndCheckout(token: string, eventId: string, seatIds: string[], expectStatus = 201) {
  const hold = await request(`/events/${eventId}/holds`, { method: "POST", token, body: { seatIds } });
  assert.equal(hold.status, expectStatus, `hold failed: ${JSON.stringify(hold.data)}`);
  if (expectStatus !== 201) return null;
  const checkout = await request(`/holds/${(hold.data as Json).id}/checkout`, { method: "POST", token, body: {} });
  assert.equal(checkout.status, 201);
  return checkout.data as Json;
}

async function sellOutCategory(token: string, eventId: string, category: string) {
  let sold = 0;
  for (;;) {
    const open = (await seats(eventId)).filter((seat) => seat.category === category && seat.status === "AVAILABLE");
    if (!open.length) break;
    await holdAndCheckout(token, eventId, open.slice(0, 8).map((seat) => seat.id));
    sold += open.slice(0, 8).length;
  }
  return sold;
}

async function pendingOffers(token: string) {
  const result = await request("/waitlist/offers", { token });
  assert.equal(result.status, 200);
  return (result.data as Json[]).filter((offer) => offer.status === "PENDING");
}

test("concurrent seat holds have one winner", async (t) => {
  if (!api) {
    t.skip("Set TEST_API_URL to a running seeded API to run integration tests");
    return;
  }
  const [a, b] = [await register("Hold A"), await register("Hold B")];
  const eventId = await freshEventId();
  const target = (await seats(eventId)).find((seat) => seat.status === "AVAILABLE");
  assert.ok(target, "needs an available seat");
  const requestHold = (token: string) =>
    request(`/events/${eventId}/holds`, { method: "POST", token, body: { seatIds: [target.id] } });
  const responses = await Promise.all([requestHold(a), requestHold(b)]);
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 409).length, 1);
});

test("held seats auto-release when the TTL expires", async (t) => {
  if (!api) {
    t.skip("Set TEST_API_URL to a running seeded API to run integration tests");
    return;
  }
  const customer = await register("TTL Customer");
  const eventId = await freshEventId();
  const target = (await seats(eventId)).find((seat) => seat.status === "AVAILABLE");
  assert.ok(target, "needs an available seat");
  const hold = await request(`/events/${eventId}/holds`, { method: "POST", token: customer, body: { seatIds: [target.id] } });
  assert.equal(hold.status, 201);
  const expiresAt = new Date((hold.data as Json).expiresAt as string).getTime();
  if (expiresAt - Date.now() > 90_000) {
    t.skip("HOLD_TTL_MINUTES is longer than 1.5 minutes; set it to ~0.05 for this test");
    return;
  }
  const afterHold = (await seats(eventId)).find((seat) => seat.id === target.id);
  assert.equal(afterHold?.status, "HELD");
  const released = await waitFor(async () => (await seats(eventId)).find((seat) => seat.id === target.id)?.status === "AVAILABLE", 120_000, 1000);
  assert.equal(released, true, "hold was not auto-released before its TTL plus sweep interval");
});

test("cancellation offers a freed seat to the waitlist head, and claiming confirms it", async (t) => {
  if (!api) {
    t.skip("Set TEST_API_URL to a running seeded API to run integration tests");
    return;
  }
  const seller = await register("Waitlist Seller");
  const eventId = await freshEventId();
  const soldTotal = await sellOutCategory(seller, eventId, "PREMIUM");
  assert.equal(soldTotal, 24, "expected the seeded 24 premium seats to sell out");

  const [w1, w2] = [await register("Waiter One"), await register("Waiter Two")];
  for (const token of [w1, w2]) {
    const joined = await request("/waitlist", { method: "POST", token, body: { eventId, category: "PREMIUM" } });
    assert.equal(joined.status, 201);
  }

  const sellerBookings = (await request("/bookings", { token: seller })).data as Json[];
  const firstBooking = sellerBookings[sellerBookings.length - 1];
  assert.equal(firstBooking.seats.length, 8);
  const cancelled = await request(`/bookings/${firstBooking.id}/cancel`, { method: "POST", token: seller });
  assert.equal(cancelled.status, 200);

  const [offerW1] = await pendingOffers(w1);
  const [offerW2] = await pendingOffers(w2);
  assert.ok(offerW1, "waitlist head should receive an offer");
  assert.ok(offerW2, "second waiter should receive the second freed seat");
  const freedSeats = (await seats(eventId)).filter((seat) => seat.category === "PREMIUM" && seat.status === "AVAILABLE");
  assert.equal(freedSeats.length, 6, "the remaining six cancelled seats should be back on sale");

  const claimed = await request(`/waitlist/offers/${offerW1.id}/claim`, { method: "POST", token: w1 });
  assert.equal(claimed.status, 200);
  const bookingId = (claimed.data as Json).bookingId as string;
  assert.ok(bookingId, "claim should return a booking id");
  const booking = await request(`/bookings/${bookingId}`, { token: w1 });
  assert.equal((booking.data as Json).status, "CONFIRMED");
  assert.equal(((booking.data as Json).seats as Json[]).length, 1);

  // Re-sell the leftover premium seats so the category stays sold out for the next test.
  const leftovers = (await seats(eventId)).filter((seat) => seat.category === "PREMIUM" && seat.status === "AVAILABLE");
  while (leftovers.length) {
    const batch = leftovers.splice(0, 8).map((seat) => seat.id);
    await holdAndCheckout(seller, eventId, batch);
  }
  waitlistContext = { eventId, w2Token: w2, w2Offer: offerW2 };
});

test("an expired offer passes the seat to the next in line", async (t) => {
  if (!api) {
    t.skip("Set TEST_API_URL to a running seeded API to run integration tests");
    return;
  }
  if (!waitlistContext) {
    t.skip("previous waitlist test did not run");
    return;
  }
  const context = waitlistContext;
  const w3 = await register("Waiter Three");
  const joined = await request("/waitlist", { method: "POST", token: w3, body: { eventId: context.eventId, category: "PREMIUM" } });
  assert.equal(joined.status, 201, "third waiter should join behind the offered head");

  const expiresAt = new Date(context.w2Offer.expiresAt as string).getTime();
  if (expiresAt - Date.now() > 180_000) {
    t.skip("WAITLIST_OFFER_MINUTES is longer than 3 minutes; set it small for this test");
    return;
  }

  const handedOff = await waitFor(async () => {
    const offers = await pendingOffers(w3);
    return offers.some((offer) => offer.id !== context.w2Offer.id && offer.seat?.id === context.w2Offer.seat?.id);
  }, 150_000, 1500);
  assert.equal(handedOff, true, "expired offer seat was not re-offered to the next waiter");

  const w2Offers = await request("/waitlist/offers", { token: context.w2Token });
  const expired = (w2Offers.data as Json[]).find((offer) => offer.id === context.w2Offer.id);
  assert.equal(expired?.status, "EXPIRED", "unclaimed offer should expire");

  const w2List = (await request("/waitlist", { token: context.w2Token })).data as Json[];
  const entry = w2List.find((row) => row.event?.id === context.eventId);
  if (entry) assert.equal(entry.status, "WAITING", "expired waiter should fall back to WAITING");
});

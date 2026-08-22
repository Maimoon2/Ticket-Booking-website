import { Router, type Response } from "express";
import { pool } from "@workspace/db";
import { randomBytes } from "node:crypto";
import { hashPassword, issueToken, requireAuth, requireRole, verifyPassword, type AuthRequest } from "../lib/auth";
import { makeQrData, sendTicketEmail, sendWaitlistOfferEmail } from "../lib/email";

const router = Router();
const holdMinutes = () => Number(process.env.HOLD_TTL_MINUTES || 10);

const user = (r: any) => ({ id: r.id, name: r.name, email: r.email, role: r.role });
const money = (v: any) => Number(v || 0);
const venue = (r: any) => ({
  id: r.venue_id ?? r.id,
  name: r.venue_name ?? r.name,
  address: r.venue_address ?? r.address,
  city: r.venue_city ?? r.city,
  capacity: Number(r.capacity || 0),
  seatCount: Number(r.seat_count ?? r.seatCount ?? 0),
});
const event = (r: any) => ({
  id: r.event_id ?? r.id,
  title: r.title,
  category: r.category,
  description: r.description,
  imageUrl: r.image_url ?? r.imageUrl ?? null,
  startsAt: r.starts_at ?? r.startsAt,
  venue: venue(r),
  minPrice: Math.min(money(r.premium_price), money(r.standard_price)),
  availableSeats: Number(r.available_seats ?? 0),
});
const seat = (r: any) => ({
  id: r.seat_id ?? r.id,
  label: `${r.row}${r.number}`,
  row: r.row,
  number: Number(r.number),
  category: r.category,
  price: money(r.price),
});

function sendError(res: Response, status: number, error: string, code?: string) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}

async function eventById(id: string) {
  const result = await pool.query(
    `SELECT e.*, v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,
       (SELECT COUNT(*) FROM seats s WHERE s.venue_id=e.venue_id) seat_count,
       (SELECT COUNT(*) FROM event_seats es WHERE es.event_id=e.id AND es.status='AVAILABLE') available_seats
     FROM events e JOIN venues v ON v.id=e.venue_id WHERE e.id=$1`,
    [id],
  );
  return result.rows[0];
}

async function bookingPayload(id: string) {
  const result = await pool.query(
    `SELECT b.*, u.id customer_id,u.name customer_name,u.email customer_email,u.role customer_role,
       e.id event_id,e.title,e.category,e.description,e.image_url,e.starts_at,e.premium_price,e.standard_price,
       v.id venue_id,v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,
       (SELECT COUNT(*) FROM seats ss WHERE ss.venue_id=v.id) seat_count
     FROM bookings b JOIN users u ON u.id=b.customer_id JOIN events e ON e.id=b.event_id
     JOIN venues v ON v.id=e.venue_id WHERE b.id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const seats = await pool.query(
    `SELECT s.* FROM booking_seats bs JOIN event_seats es ON es.id=bs.event_seat_id JOIN seats s ON s.id=es.seat_id
     WHERE bs.booking_id=$1 ORDER BY s.row,s.number`,
    [id],
  );
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    total: money(row.total),
    createdAt: row.created_at,
    customer: user({ id: row.customer_id, name: row.customer_name, email: row.customer_email, role: row.customer_role }),
    event: event(row),
    seats: seats.rows.map(seat),
    qrData: row.qr_data || "",
  };
}

async function promoteSeat(client: any, eventSeat: any) {
  const result = await client.query(
    `SELECT w.*,u.email,e.title FROM waitlist w JOIN users u ON u.id=w.customer_id JOIN events e ON e.id=w.event_id
     WHERE w.event_id=$1 AND w.category=(SELECT category FROM seats WHERE id=$2) AND w.status='WAITING'
     ORDER BY w.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    [eventSeat.event_id, eventSeat.seat_id],
  );
  const next = result.rows[0];
  if (!next) return;
  const offer = await client.query(
    `INSERT INTO waitlist_offers (waitlist_id,event_id,seat_id,expires_at,status)
     VALUES ($1,$2,$3,NOW()+INTERVAL '15 minutes','PENDING') RETURNING id,expires_at`,
    [next.id, eventSeat.event_id, eventSeat.seat_id],
  );
  await client.query(`UPDATE waitlist SET status='OFFERED' WHERE id=$1`, [next.id]);
  await client.query(
    `UPDATE event_seats SET status='OFFERED',offered_to_waitlist_offer_id=$1,held_until=$2 WHERE id=$3 AND status='AVAILABLE'`,
    [offer.rows[0].id, offer.rows[0].expires_at, eventSeat.id],
  );
  void sendWaitlistOfferEmail(next.email, next.title, offer.rows[0].id, offer.rows[0].expires_at);
}

router.post("/auth/register", async (req, res) => {
  const { name, email, password, role = "CUSTOMER" } = req.body || {};
  if (!name || !email || typeof password !== "string" || password.length < 8) return sendError(res, 400, "Name, email, and an 8+ character password are required");
  const safeRole = role === "ORGANISER" ? "ORGANISER" : "CUSTOMER";
  try {
    const created = await pool.query(
      `INSERT INTO users (name,email,password_hash,role) VALUES ($1,LOWER($2),$3,$4) RETURNING id,name,email,role`,
      [String(name).trim(), email, await hashPassword(password), safeRole],
    );
    const u = user(created.rows[0]);
    return res.status(201).json({ token: issueToken(u), user: u });
  } catch (error: any) {
    if (error?.code === "23505") return sendError(res, 409, "An account with that email already exists");
    return sendError(res, 500, "Unable to create account");
  }
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const found = await pool.query(`SELECT id,name,email,password_hash,role FROM users WHERE email=LOWER($1)`, [email || ""]);
  if (!found.rows[0] || !(await verifyPassword(password || "", found.rows[0].password_hash))) return sendError(res, 401, "Email or password is incorrect");
  const u = user(found.rows[0]);
  return res.json({ token: issueToken(u), user: u });
});

router.get("/auth/me", requireAuth, (req, res) => res.json((req as AuthRequest).user));

router.get("/events", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const category = req.query.category === "MOVIE" || req.query.category === "CONCERT" ? req.query.category : null;
  const date = String(req.query.date || "").trim();
  const result = await pool.query(
    `SELECT e.*,v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,
      (SELECT COUNT(*) FROM seats s WHERE s.venue_id=e.venue_id) seat_count,
      (SELECT COUNT(*) FROM event_seats es WHERE es.event_id=e.id AND es.status='AVAILABLE') available_seats
     FROM events e JOIN venues v ON v.id=e.venue_id
     WHERE e.starts_at > NOW() AND ($1='' OR e.title ILIKE '%'||$1||'%' OR e.description ILIKE '%'||$1||'%')
       AND ($2::event_category IS NULL OR e.category=$2) AND ($3='' OR e.starts_at::date=$3::date)
     ORDER BY e.starts_at`,
    [q, category, date],
  );
  return res.json(result.rows.map(event));
});

router.get("/events/:id", async (req, res) => {
  const row = await eventById(req.params.id);
  if (!row) return sendError(res, 404, "Event not found");
  const organiser = await pool.query(`SELECT id,name,email,role FROM users WHERE id=$1`, [row.organiser_id]);
  return res.json({ ...event(row), organiser: organiser.rows[0] ? user(organiser.rows[0]) : null });
});

router.post("/events", requireAuth, requireRole("ORGANISER", "ADMIN"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const { title, category, description, imageUrl, startsAt, venueId, premiumPrice, standardPrice } = req.body || {};
  if (!title || !["MOVIE", "CONCERT"].includes(category) || !description || !startsAt || !venueId) return sendError(res, 400, "Title, category, description, start time, and venue are required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO events (organiser_id,venue_id,title,category,description,image_url,starts_at,premium_price,standard_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [actor.id, venueId, title, category, description, imageUrl || null, startsAt, Number(premiumPrice || 0), Number(standardPrice || 0)],
    );
    await client.query(
      `INSERT INTO event_seats (event_id,seat_id) SELECT $1,id FROM seats WHERE venue_id=$2`,
      [created.rows[0].id, venueId],
    );
    await client.query("COMMIT");
    const row = await eventById(created.rows[0].id);
    return res.status(201).json(event(row));
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error?.code === "23503") return sendError(res, 404, "Venue not found");
    return sendError(res, 400, "Unable to create event");
  } finally {
    client.release();
  }
});

router.patch("/events/:id", requireAuth, requireRole("ORGANISER", "ADMIN"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const current = await pool.query(`SELECT * FROM events WHERE id=$1`, [req.params.id]);
  if (!current.rows[0]) return sendError(res, 404, "Event not found");
  if (actor.role !== "ADMIN" && current.rows[0].organiser_id !== actor.id) return sendError(res, 403, "You can only edit your own events");
  const b = req.body || {};
  const updated = await pool.query(
    `UPDATE events SET title=COALESCE($1,title),description=COALESCE($2,description),starts_at=COALESCE($3,starts_at),
      premium_price=COALESCE($4,premium_price),standard_price=COALESCE($5,standard_price) WHERE id=$6`,
    [b.title || null, b.description || null, b.startsAt || null, b.premiumPrice == null ? null : Number(b.premiumPrice), b.standardPrice == null ? null : Number(b.standardPrice), req.params.id],
  );
  return res.json(event(await eventById(String(req.params.id))));
});

router.get("/events/:id/seats", async (req, res) => {
  await pool.query(`UPDATE event_seats SET status='AVAILABLE',hold_id=NULL,held_until=NULL WHERE event_id=$1 AND status='HELD' AND held_until<=NOW()`, [req.params.id]);
  const result = await pool.query(
    `SELECT es.id event_seat_id,es.status,es.held_until,s.* FROM event_seats es JOIN seats s ON s.id=es.seat_id WHERE es.event_id=$1 ORDER BY s.row,s.number`,
    [req.params.id],
  );
  return res.json(result.rows.map((r) => ({ ...seat(r), eventSeatId: r.event_seat_id, status: r.status, heldUntil: r.held_until })));
});

router.post("/events/:id/holds", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const customer = (req as AuthRequest).user!;
  const ids = Array.isArray(req.body?.seatIds) ? [...new Set(req.body.seatIds)] : [];
  if (!ids.length || ids.length > 8) return sendError(res, 400, "Choose between 1 and 8 seats");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE event_seats SET status='AVAILABLE',hold_id=NULL,held_until=NULL WHERE event_id=$1 AND status='HELD' AND held_until<=NOW()`, [req.params.id]);
    const selected = await client.query(
      `SELECT es.*,s.price FROM event_seats es JOIN seats s ON s.id=es.seat_id WHERE es.event_id=$1 AND es.seat_id=ANY($2::uuid[]) FOR UPDATE`,
      [req.params.id, ids],
    );
    if (selected.rows.length !== ids.length || selected.rows.some((r) => r.status !== "AVAILABLE")) {
      await client.query("ROLLBACK");
      return sendError(res, 409, "One or more selected seats are no longer available", "SEAT_CONFLICT");
    }
    const expiresAt = new Date(Date.now() + holdMinutes() * 60_000);
    const hold = await client.query(
      `INSERT INTO seat_holds (event_id,customer_id,expires_at,status) VALUES ($1,$2,$3,'HELD') RETURNING id,expires_at`,
      [req.params.id, customer.id, expiresAt],
    );
    await client.query(
      `UPDATE event_seats SET status='HELD',hold_id=$1,held_until=$2 WHERE id=ANY($3::uuid[]) AND status='AVAILABLE'`,
      [hold.rows[0].id, expiresAt, selected.rows.map((r) => r.id)],
    );
    await client.query("COMMIT");
    return res.status(201).json({ id: hold.rows[0].id, eventId: req.params.id, seatIds: selected.rows.map((r) => r.seat_id), expiresAt: hold.rows[0].expires_at, total: selected.rows.reduce((sum, r) => sum + money(r.price), 0) });
  } catch {
    await client.query("ROLLBACK");
    return sendError(res, 409, "Seats could not be held; please refresh and try again", "SEAT_CONFLICT");
  } finally {
    client.release();
  }
});

router.get("/holds/:id", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const customer = (req as AuthRequest).user!;
  const hold = await pool.query(`SELECT h.*,COALESCE(SUM(s.price),0) total,ARRAY_AGG(es.seat_id) seat_ids FROM seat_holds h JOIN event_seats es ON es.hold_id=h.id JOIN seats s ON s.id=es.seat_id WHERE h.id=$1 AND h.customer_id=$2 GROUP BY h.id`, [req.params.id, customer.id]);
  if (!hold.rows[0]) return sendError(res, 404, "Hold not found");
  if (hold.rows[0].status !== "HELD" || new Date(hold.rows[0].expires_at) <= new Date()) return sendError(res, 410, "This seat hold has expired");
  return res.json({ id: hold.rows[0].id, eventId: hold.rows[0].event_id, seatIds: hold.rows[0].seat_ids, expiresAt: hold.rows[0].expires_at, total: money(hold.rows[0].total) });
});

router.post("/holds/:id/checkout", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const customer = (req as AuthRequest).user!;
  const client = await pool.connect();
  let bookingId = "";
  try {
    await client.query("BEGIN");
    const hold = await client.query(`SELECT * FROM seat_holds WHERE id=$1 AND customer_id=$2 FOR UPDATE`, [req.params.id, customer.id]);
    if (!hold.rows[0]) { await client.query("ROLLBACK"); return sendError(res, 404, "Hold not found"); }
    if (hold.rows[0].status !== "HELD" || new Date(hold.rows[0].expires_at) <= new Date()) { await client.query("ROLLBACK"); return sendError(res, 410, "Your checkout hold has expired"); }
    const held = await client.query(`SELECT es.*,s.price FROM event_seats es JOIN seats s ON s.id=es.seat_id WHERE es.hold_id=$1 AND es.status='HELD' FOR UPDATE`, [req.params.id]);
    if (!held.rows.length) { await client.query("ROLLBACK"); return sendError(res, 409, "These seats are no longer held"); }
    const total = held.rows.reduce((sum, r) => sum + money(r.price), 0);
    const reference = `SP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const created = await client.query(
      `INSERT INTO bookings (reference,event_id,customer_id,status,total) VALUES ($1,$2,$3,'CONFIRMED',$4) RETURNING id`,
      [reference, hold.rows[0].event_id, customer.id, total],
    );
    bookingId = created.rows[0].id;
    for (const item of held.rows) await client.query(`INSERT INTO booking_seats (booking_id,event_seat_id,price) VALUES ($1,$2,$3)`, [bookingId, item.id, item.price]);
    await client.query(`UPDATE event_seats SET status='BOOKED',hold_id=NULL,held_until=NULL WHERE hold_id=$1 AND status='HELD'`, [req.params.id]);
    await client.query(`UPDATE seat_holds SET status='CHECKED_OUT' WHERE id=$1`, [req.params.id]);
    await client.query("COMMIT");
    const qrData = await makeQrData(reference);
    await pool.query(`UPDATE bookings SET qr_data=$1 WHERE id=$2`, [qrData, bookingId]);
    const payload = await bookingPayload(bookingId);
    if (payload) void sendTicketEmail({ email: payload.customer.email, name: payload.customer.name, reference, title: payload.event.title, venue: payload.event.venue.name, startsAt: new Date(payload.event.startsAt).toLocaleString(), seats: payload.seats.map((s: any) => s.label), qrData });
    return res.status(201).json({ ...payload, qrData });
  } catch {
    await client.query("ROLLBACK");
    return sendError(res, 409, "Checkout could not be completed");
  } finally {
    client.release();
  }
});

router.get("/bookings", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const customer = (req as AuthRequest).user!;
  const list = await pool.query(`SELECT id FROM bookings WHERE customer_id=$1 ORDER BY created_at DESC`, [customer.id]);
  return res.json((await Promise.all(list.rows.map((r) => bookingPayload(r.id)))).filter(Boolean));
});

router.get("/bookings/:id", requireAuth, async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const check = await pool.query(`SELECT customer_id,event_id FROM bookings WHERE id=$1`, [req.params.id]);
  if (!check.rows[0]) return sendError(res, 404, "Booking not found");
  if (actor.role === "CUSTOMER" && check.rows[0].customer_id !== actor.id) return sendError(res, 403, "This booking does not belong to you");
  const payload = await bookingPayload(String(req.params.id));
  return res.json(payload);
});

router.post("/bookings/:id/cancel", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const booking = await client.query(`SELECT * FROM bookings WHERE id=$1 AND customer_id=$2 FOR UPDATE`, [req.params.id, actor.id]);
    if (!booking.rows[0]) { await client.query("ROLLBACK"); return sendError(res, 404, "Booking not found"); }
    if (booking.rows[0].status !== "CONFIRMED") { await client.query("ROLLBACK"); return sendError(res, 409, "Booking is already cancelled"); }
    const seats = await client.query(`SELECT es.* FROM booking_seats bs JOIN event_seats es ON es.id=bs.event_seat_id WHERE bs.booking_id=$1 FOR UPDATE`, [req.params.id]);
    await client.query(`UPDATE bookings SET status='CANCELLED' WHERE id=$1`, [req.params.id]);
    for (const es of seats.rows) {
      await client.query(`UPDATE event_seats SET status='AVAILABLE',hold_id=NULL,held_until=NULL,offered_to_waitlist_offer_id=NULL WHERE id=$1 AND status='BOOKED'`, [es.id]);
      await promoteSeat(client, es);
    }
    await client.query("COMMIT");
    return res.json(await bookingPayload(String(req.params.id)));
  } catch {
    await client.query("ROLLBACK");
    return sendError(res, 409, "Cancellation could not be completed");
  } finally {
    client.release();
  }
});

router.get("/waitlist", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const result = await pool.query(
    `SELECT w.*,e.title,e.category,e.description,e.starts_at,e.image_url,e.premium_price,e.standard_price,e.venue_id,
       v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,
       (SELECT COUNT(*) FROM seats s WHERE s.venue_id=v.id) seat_count,
       (SELECT COUNT(*) FROM waitlist w2 WHERE w2.event_id=w.event_id AND w2.category=w.category AND w2.status='WAITING' AND w2.created_at<=w.created_at) position
     FROM waitlist w JOIN events e ON e.id=w.event_id JOIN venues v ON v.id=e.venue_id
     WHERE w.customer_id=$1 ORDER BY w.created_at DESC`,
    [actor.id],
  );
  return res.json(result.rows.map((r) => ({ id: r.id, event: event(r), category: r.category, position: Number(r.position), status: r.status })));
});

router.post("/waitlist", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const { eventId, category } = req.body || {};
  if (!eventId || !["PREMIUM", "STANDARD"].includes(category)) return sendError(res, 400, "Event and seat category are required");
  try {
    const result = await pool.query(`INSERT INTO waitlist (event_id,customer_id,category) VALUES ($1,$2,$3) RETURNING id,created_at`, [eventId, actor.id, category]);
    const row = await pool.query(`SELECT e.*,v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,(SELECT COUNT(*) FROM seats s WHERE s.venue_id=v.id) seat_count FROM events e JOIN venues v ON v.id=e.venue_id WHERE e.id=$1`, [eventId]);
    return res.status(201).json({ id: result.rows[0].id, event: event(row.rows[0]), category, position: 1, status: "WAITING" });
  } catch (error: any) {
    if (error?.code === "23505") return sendError(res, 409, "You are already on this waitlist");
    return sendError(res, 404, "Event not found");
  }
});

router.get("/waitlist/offers", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  await pool.query(`UPDATE waitlist_offers SET status='EXPIRED' WHERE status='PENDING' AND expires_at<=NOW()`);
  const result = await pool.query(
    `SELECT wo.*,e.title,e.category,e.description,e.starts_at,e.image_url,e.premium_price,e.standard_price,e.venue_id,
       v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,s.row,s.number,s.category seat_category,s.price
     FROM waitlist_offers wo JOIN waitlist w ON w.id=wo.waitlist_id JOIN events e ON e.id=wo.event_id JOIN venues v ON v.id=e.venue_id JOIN seats s ON s.id=wo.seat_id
     WHERE w.customer_id=$1 ORDER BY wo.created_at DESC`,
    [actor.id],
  );
  return res.json(result.rows.map((r) => ({ id: r.id, eventId: r.event_id, seatId: r.seat_id, expiresAt: r.expires_at, status: r.status, event: event(r), seat: { id: r.seat_id, label: `${r.row}${r.number}`, row: r.row, number: Number(r.number), category: r.seat_category, price: money(r.price) } })));
});

router.post("/waitlist/offers/:id/claim", requireAuth, requireRole("CUSTOMER"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const offer = await client.query(
      `SELECT wo.*,w.customer_id FROM waitlist_offers wo JOIN waitlist w ON w.id=wo.waitlist_id WHERE wo.id=$1 FOR UPDATE`,
      [req.params.id],
    );
    if (!offer.rows[0] || offer.rows[0].customer_id !== actor.id) { await client.query("ROLLBACK"); return sendError(res, 404, "Offer not found"); }
    if (offer.rows[0].status !== "PENDING" || new Date(offer.rows[0].expires_at) <= new Date()) { await client.query("ROLLBACK"); return sendError(res, 410, "This offer has expired"); }
    const locked = await client.query(`SELECT es.*,s.price FROM event_seats es JOIN seats s ON s.id=es.seat_id WHERE es.event_id=$1 AND es.seat_id=$2 AND es.status='OFFERED' AND es.offered_to_waitlist_offer_id=$3 FOR UPDATE`, [offer.rows[0].event_id, offer.rows[0].seat_id, req.params.id]);
    if (!locked.rows[0]) { await client.query("ROLLBACK"); return sendError(res, 410, "That seat is no longer available"); }
    const ref = `SP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const booking = await client.query(`INSERT INTO bookings (reference,event_id,customer_id,status,total) VALUES ($1,$2,$3,'CONFIRMED',$4) RETURNING id`, [ref, offer.rows[0].event_id, actor.id, locked.rows[0].price]);
    await client.query(`INSERT INTO booking_seats (booking_id,event_seat_id,price) VALUES ($1,$2,$3)`, [booking.rows[0].id, locked.rows[0].id, locked.rows[0].price]);
    await client.query(`UPDATE event_seats SET status='BOOKED',offered_to_waitlist_offer_id=NULL,held_until=NULL WHERE id=$1`, [locked.rows[0].id]);
    await client.query(`UPDATE waitlist_offers SET status='ACCEPTED' WHERE id=$1`, [req.params.id]);
    await client.query(`UPDATE waitlist SET status='FULFILLED' WHERE id=$1`, [offer.rows[0].waitlist_id]);
    await client.query("COMMIT");
    const qrData = await makeQrData(ref);
    await pool.query(`UPDATE bookings SET qr_data=$1 WHERE id=$2`, [qrData, booking.rows[0].id]);
    return res.json({ id: req.params.id, eventId: offer.rows[0].event_id, seatId: offer.rows[0].seat_id, expiresAt: offer.rows[0].expires_at, status: "ACCEPTED" });
  } catch {
    await client.query("ROLLBACK");
    return sendError(res, 409, "Offer could not be claimed");
  } finally {
    client.release();
  }
});

router.get("/organiser/events", requireAuth, requireRole("ORGANISER", "ADMIN"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const result = await pool.query(
    `SELECT e.*,v.name venue_name,v.address venue_address,v.city venue_city,v.capacity,(SELECT COUNT(*) FROM seats s WHERE s.venue_id=e.venue_id) seat_count,(SELECT COUNT(*) FROM event_seats es WHERE es.event_id=e.id AND es.status='AVAILABLE') available_seats FROM events e JOIN venues v ON v.id=e.venue_id WHERE ($1='ADMIN' OR e.organiser_id=$2) ORDER BY e.starts_at`,
    [actor.role, actor.id],
  );
  return res.json(result.rows.map(event));
});

router.get("/organiser/events/:id/analytics", requireAuth, requireRole("ORGANISER", "ADMIN"), async (req, res) => {
  const actor = (req as AuthRequest).user!;
  const owner = await pool.query(`SELECT organiser_id FROM events WHERE id=$1`, [req.params.id]);
  if (!owner.rows[0]) return sendError(res, 404, "Event not found");
  if (actor.role !== "ADMIN" && owner.rows[0].organiser_id !== actor.id) return sendError(res, 403, "You can only view your own events");
  const result = await pool.query(
    `SELECT COUNT(DISTINCT b.id)::int total_bookings,COALESCE(SUM(b.total) FILTER (WHERE b.status='CONFIRMED'),0) revenue,
      COUNT(*) FILTER (WHERE b.status='CONFIRMED')::int sold,
      (SELECT COUNT(*) FROM event_seats WHERE event_id=$1)::int capacity
     FROM bookings b WHERE b.event_id=$1`,
    [req.params.id],
  );
  const r = result.rows[0];
  const recent = await pool.query(`SELECT id FROM bookings WHERE event_id=$1 ORDER BY created_at DESC LIMIT 5`, [req.params.id]);
  const recentBookings = (await Promise.all(recent.rows.map((row) => bookingPayload(row.id)))).filter(Boolean);
  return res.json({ totalEvents: 1, totalBookings: Number(r.total_bookings), revenue: money(r.revenue), occupancy: r.capacity ? (Number(r.sold) / Number(r.capacity)) * 100 : 0, recentBookings });
});

router.get("/venues", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const result = await pool.query(`SELECT v.*,COUNT(s.id)::int seat_count FROM venues v LEFT JOIN seats s ON s.venue_id=v.id GROUP BY v.id ORDER BY v.name`);
  return res.json(result.rows.map(venue));
});

router.get("/venues/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const result = await pool.query(`SELECT v.*,COUNT(s.id)::int seat_count FROM venues v LEFT JOIN seats s ON s.venue_id=v.id WHERE v.id=$1 GROUP BY v.id`, [req.params.id]);
  if (!result.rows[0]) return sendError(res, 404, "Venue not found");
  const seats = await pool.query(`SELECT * FROM seats WHERE venue_id=$1 ORDER BY row,number`, [req.params.id]);
  return res.json({ ...venue(result.rows[0]), seats: seats.rows.map(seat) });
});

router.post("/venues", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { name, address, city } = req.body || {};
  if (!name || !address || !city) return sendError(res, 400, "Name, address, and city are required");
  const result = await pool.query(`INSERT INTO venues (name,address,city) VALUES ($1,$2,$3) RETURNING *`, [name, address, city]);
  return res.status(201).json(venue(result.rows[0]));
});

router.patch("/venues/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const b = req.body || {};
  const result = await pool.query(`UPDATE venues SET name=COALESCE($1,name),address=COALESCE($2,address),city=COALESCE($3,city) WHERE id=$4 RETURNING *`, [b.name || null, b.address || null, b.city || null, req.params.id]);
  if (!result.rows[0]) return sendError(res, 404, "Venue not found");
  return res.json(venue(result.rows[0]));
});

router.delete("/venues/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const result = await pool.query(`DELETE FROM venues WHERE id=$1 RETURNING id`, [req.params.id]);
  if (!result.rows[0]) return sendError(res, 404, "Venue not found");
  return res.status(204).send();
});

router.post("/venues/:id/seats", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { row, number, category, price } = req.body || {};
  if (!row || !Number.isInteger(Number(number)) || !["PREMIUM", "STANDARD"].includes(category) || price == null) return sendError(res, 400, "Row, seat number, category, and price are required");
  try {
    const result = await pool.query(`INSERT INTO seats (venue_id,row,number,category,price) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.params.id, row, Number(number), category, Number(price)]);
    await pool.query(`UPDATE venues SET capacity=(SELECT COUNT(*) FROM seats WHERE venue_id=$1) WHERE id=$1`, [req.params.id]);
    return res.status(201).json(seat(result.rows[0]));
  } catch (error: any) {
    if (error?.code === "23505") return sendError(res, 409, "That seat already exists");
    return sendError(res, 404, "Venue not found");
  }
});

router.get("/dashboard", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const result = await pool.query(`SELECT (SELECT COUNT(*) FROM events)::int total_events,(SELECT COUNT(*) FROM bookings WHERE status='CONFIRMED')::int total_bookings,COALESCE((SELECT SUM(total) FROM bookings WHERE status='CONFIRMED'),0) revenue,(SELECT COUNT(*) FROM event_seats WHERE status='BOOKED')::float / NULLIF((SELECT COUNT(*) FROM event_seats),0) occupancy`);
  const r = result.rows[0];
  const recent = await pool.query(`SELECT id FROM bookings ORDER BY created_at DESC LIMIT 5`);
  const recentBookings = (await Promise.all(recent.rows.map((row) => bookingPayload(row.id)))).filter(Boolean);
  return res.json({ totalEvents: Number(r.total_events), totalBookings: Number(r.total_bookings), revenue: money(r.revenue), occupancy: Number(r.occupancy || 0) * 100, recentBookings });
});

export default router;
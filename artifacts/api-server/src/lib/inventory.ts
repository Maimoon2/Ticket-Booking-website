import { pool } from "@workspace/db";
import { audit } from "./audit";
import { sendWaitlistOfferEmail } from "./email";
import { logger } from "./logger";

export const SEAT_PRICE_SQL = `CASE WHEN s.category='PREMIUM' THEN e.premium_price ELSE e.standard_price END`;

export const offerMinutes = () => {
  const value = Number(process.env.WAITLIST_OFFER_MINUTES || 15);
  return Number.isFinite(value) && value > 0 ? value : 15;
};

export async function promoteSeat(client: { query: Function }, eventSeat: { id: string; event_id: string; seat_id: string }, excludeWaitlistId?: string) {
  const result = await client.query(
    `SELECT w.*,u.email,e.title FROM waitlist w
     JOIN users u ON u.id=w.customer_id JOIN events e ON e.id=w.event_id
     WHERE w.event_id=$1 AND w.category=(SELECT category FROM seats WHERE id=$2) AND w.status='WAITING'
       AND ($3::uuid IS NULL OR w.id<>$3)
     ORDER BY w.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    [eventSeat.event_id, eventSeat.seat_id, excludeWaitlistId ?? null],
  );
  const next = result.rows[0];
  if (!next) return;
  const expiresAt = new Date(Date.now() + offerMinutes() * 60_000);
  const offer = await client.query(
    `INSERT INTO waitlist_offers (waitlist_id,event_id,seat_id,expires_at,status)
     VALUES ($1,$2,$3,$4,'PENDING') RETURNING id,expires_at`,
    [next.id, eventSeat.event_id, eventSeat.seat_id, expiresAt],
  );
  await client.query(`UPDATE waitlist SET status='OFFERED' WHERE id=$1`, [next.id]);
  await client.query(
    `UPDATE event_seats SET status='OFFERED',offered_to_waitlist_offer_id=$1,held_until=$2 WHERE id=$3 AND status='AVAILABLE'`,
    [offer.rows[0].id, offer.rows[0].expires_at, eventSeat.id],
  );
  void sendWaitlistOfferEmail(next.email, next.title, offer.rows[0].id, offer.rows[0].expires_at);
  void audit("WAITLIST_OFFER_CREATED", next.customer_id, offer.rows[0].id, { eventId: eventSeat.event_id, waitlistId: next.id });
}

export async function releaseExpiredHoldsAndOffers(eventId?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query(
      `SELECT id,event_id FROM seat_holds
       WHERE status='HELD' AND expires_at <= NOW() AND ($1::uuid IS NULL OR event_id=$1)
       FOR UPDATE SKIP LOCKED`,
      [eventId ?? null],
    );
    for (const hold of expired.rows) {
      const seats = await client.query(`SELECT * FROM event_seats WHERE hold_id=$1 AND status='HELD' FOR UPDATE`, [hold.id]);
      for (const seat of seats.rows) {
        await client.query(
          `UPDATE event_seats SET status='AVAILABLE',hold_id=NULL,held_until=NULL WHERE id=$1 AND status='HELD'`,
          [seat.id],
        );
      }
      await client.query(`UPDATE seat_holds SET status='EXPIRED' WHERE id=$1 AND status='HELD'`, [hold.id]);
    }
    const offers = await client.query(
      `SELECT wo.*, es.id AS event_seat_id FROM waitlist_offers wo
       JOIN event_seats es ON es.offered_to_waitlist_offer_id=wo.id
       WHERE wo.status='PENDING' AND wo.expires_at <= NOW() AND ($1::uuid IS NULL OR wo.event_id=$1)
       FOR UPDATE SKIP LOCKED`,
      [eventId ?? null],
    );
    for (const offer of offers.rows) {
      await client.query(`UPDATE waitlist_offers SET status='EXPIRED' WHERE id=$1 AND status='PENDING'`, [offer.id]);
      await client.query(`UPDATE waitlist SET status='WAITING' WHERE id=$1 AND status='OFFERED'`, [offer.waitlist_id]);
      void audit("WAITLIST_OFFER_EXPIRED", null, offer.id, { eventId: offer.event_id, waitlistId: offer.waitlist_id });
      await client.query(
        `UPDATE event_seats SET status='AVAILABLE',offered_to_waitlist_offer_id=NULL,held_until=NULL
         WHERE id=$1 AND status='OFFERED' AND offered_to_waitlist_offer_id=$2`,
        [offer.event_seat_id, offer.id],
      );
      const seat = await client.query(`SELECT * FROM event_seats WHERE id=$1 AND status='AVAILABLE' FOR UPDATE`, [offer.event_seat_id]);
      if (seat.rows[0]) await promoteSeat(client, seat.rows[0], offer.waitlist_id);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Hold/offer expiry failed");
  } finally {
    client.release();
  }
}

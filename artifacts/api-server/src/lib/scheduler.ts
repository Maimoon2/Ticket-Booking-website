import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendWaitlistOfferEmail } from "./email";

async function promoteSeat(client: any, eventSeat: any) {
  const next = await client.query(
    `SELECT w.id, w.customer_id, e.title, u.email
     FROM waitlist w JOIN events e ON e.id=w.event_id JOIN users u ON u.id=w.customer_id
     WHERE w.event_id=$1 AND w.category=(SELECT category FROM seats WHERE id=$2)
       AND w.status='WAITING' ORDER BY w.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    [eventSeat.event_id, eventSeat.seat_id],
  );
  const row = next.rows[0];
  if (!row) return;
  const offer = await client.query(
    `INSERT INTO waitlist_offers (waitlist_id,event_id,seat_id,expires_at,status)
     VALUES ($1,$2,$3,NOW()+INTERVAL '15 minutes','PENDING') RETURNING id,expires_at`,
    [row.id, eventSeat.event_id, eventSeat.seat_id],
  );
  await client.query(`UPDATE waitlist SET status='OFFERED' WHERE id=$1`, [row.id]);
  await client.query(
    `UPDATE event_seats SET status='OFFERED', offered_to_waitlist_offer_id=$1, held_until=$2
     WHERE id=$3 AND status='AVAILABLE'`,
    [offer.rows[0].id, offer.rows[0].expires_at, eventSeat.id],
  );
  void sendWaitlistOfferEmail(row.email, row.title, offer.rows[0].id, offer.rows[0].expires_at);
}

export async function releaseExpiredHolds() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query(
      `SELECT id,event_id FROM seat_holds WHERE status='HELD' AND expires_at <= NOW() FOR UPDATE SKIP LOCKED`,
    );
    for (const hold of expired.rows) {
      const seats = await client.query(
        `SELECT * FROM event_seats WHERE hold_id=$1 AND status='HELD' FOR UPDATE`,
        [hold.id],
      );
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
       WHERE wo.status='PENDING' AND wo.expires_at <= NOW() FOR UPDATE SKIP LOCKED`,
    );
    for (const offer of offers.rows) {
      await client.query(`UPDATE waitlist_offers SET status='EXPIRED' WHERE id=$1 AND status='PENDING'`, [offer.id]);
      await client.query(`UPDATE waitlist SET status='WAITING' WHERE id=$1 AND status='OFFERED'`, [offer.waitlist_id]);
      await client.query(
        `UPDATE event_seats SET status='AVAILABLE',offered_to_waitlist_offer_id=NULL,held_until=NULL
         WHERE id=$1 AND status='OFFERED' AND offered_to_waitlist_offer_id=$2`,
        [offer.event_seat_id, offer.id],
      );
      const seat = await client.query(`SELECT * FROM event_seats WHERE id=$1 AND status='AVAILABLE' FOR UPDATE`, [offer.event_seat_id]);
      if (seat.rows[0]) await promoteSeat(client, seat.rows[0]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "Hold expiry scheduler failed");
  } finally {
    client.release();
  }
}

export function startScheduler() {
  const interval = Number(process.env.HOLD_SWEEP_INTERVAL_MS || 30000);
  const timer = setInterval(() => void releaseExpiredHolds(), interval);
  timer.unref();
  void releaseExpiredHolds();
}

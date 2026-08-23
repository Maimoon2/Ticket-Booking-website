import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function audit(action: string, actorId?: string | null, entityId?: string | null, metadata?: Record<string, unknown>) {
  try {
    await pool.query(`INSERT INTO audit_events (actor_id,action,entity_id,metadata) VALUES ($1,$2,$3,$4)`, [
      actorId ?? null,
      action,
      entityId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]);
  } catch (error) {
    logger.warn({ err: error, action }, "Audit write failed");
  }
}

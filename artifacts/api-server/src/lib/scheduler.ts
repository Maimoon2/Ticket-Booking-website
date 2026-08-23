import { releaseExpiredHoldsAndOffers } from "./inventory";

export function startScheduler() {
  const interval = Number(process.env.HOLD_SWEEP_INTERVAL_MS || 30000);
  const timer = setInterval(() => void releaseExpiredHoldsAndOffers(), interval);
  timer.unref();
  void releaseExpiredHoldsAndOffers();
}

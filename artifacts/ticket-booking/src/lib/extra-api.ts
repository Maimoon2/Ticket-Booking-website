import type { Hold, ClaimedWaitlistOffer } from "@workspace/api-client-react";

export type PricedEvent = {
  premiumPrice?: number;
  standardPrice?: number;
  availablePremium?: number;
  availableStandard?: number;
};

export type HoldWithLabels = Hold & { seatLabels?: string[] };

export type ClaimedOffer = ClaimedWaitlistOffer;

export type OrganiserAnalytics = {
  totalEvents: number;
  totalBookings: number;
  revenue: number;
  occupancy: number;
  dailyBookings?: number[];
  recentBookings: unknown[];
};

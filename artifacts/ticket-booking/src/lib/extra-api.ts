import { customFetch, type Analytics, type Hold } from "@workspace/api-client-react";
import { useMutation, useQuery } from "@tanstack/react-query";

export type PricedEvent = {
  premiumPrice?: number;
  standardPrice?: number;
  availablePremium?: number;
  availableStandard?: number;
};

export type HoldWithLabels = Hold & { seatLabels?: string[] };

export type ClaimedOffer = {
  id: string;
  bookingId?: string;
  status: string;
};

export type OrganiserAnalytics = Analytics & { dailyBookings?: number[] };

export function useOrganiserAnalytics() {
  return useQuery({
    queryKey: ["/api/organiser/analytics"],
    queryFn: () => customFetch<OrganiserAnalytics>("/api/organiser/analytics", { method: "GET" }),
  });
}

export function useLeaveWaitlist() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) => customFetch<void>(`/api/waitlist/${id}`, { method: "DELETE" }),
  });
}

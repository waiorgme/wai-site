import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

// Shared view-model types for the shell views, derived from the live Convex
// return shapes so the client can never drift from the server.

export type MembershipView = ReturnType<
  typeof useQuery<typeof api.membership.getMyMembership>
>;

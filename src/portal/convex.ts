import { ConvexReactClient } from "convex/react";

// Shared client for the portal islands. The deployment URL is exposed to the
// browser via Astro's PUBLIC_ prefix.
export const convex = new ConvexReactClient(
  import.meta.env.PUBLIC_CONVEX_URL as string,
);

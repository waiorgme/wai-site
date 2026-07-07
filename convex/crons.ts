import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Scheduled jobs (panel-experience slice). Convex requires this module to
// default-export the cronJobs registry; the framework convention wins over
// the repo's named-exports-only preference here (schema.ts precedent).

const crons = cronJobs();

// Spec B7: open opportunities close AUTOMATICALLY at their deadline. Deadlines
// are stored as epoch instants (entered against the "11:59 PM GST"
// convention, i.e. 19:59 UTC), so running on the hour closes a listing within
// the hour after its deadline passes. Each close writes its own system-actor
// audit row inside the internal mutation.
crons.hourly(
  "close-past-deadline-opportunities",
  { minuteUTC: 0 },
  internal.admin.opportunities.closePastDeadlineOpportunities,
);

export default crons;

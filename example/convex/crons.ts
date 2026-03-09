import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "cleanup expired secrets",
  { hours: 24 },
  internal.cleanup.cleanupSecrets,
);

crons.interval(
  "cleanup secret audit events",
  { hours: 24 },
  internal.cleanup.cleanupEvents,
);

export default crons;

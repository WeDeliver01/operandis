/**
 * One-shot maintenance run (schedule every few minutes, e.g. cron/Kubernetes CronJob):
 *  - send queued/failed transactional emails
 *  - expire abandoned gateway checkouts (>24h)
 *  - expire proposals past their validity date
 *  - delete unsubmitted configurator drafts past their 30-day expiry (privacy notice commitment)
 */
import { and, inArray, isNull, lt } from "drizzle-orm";
import { configuratorDrafts, proposals } from "@workspace/db";
import { loadConfig } from "../config/env";
import { createContext } from "../context";
import { expireStaleAttempts } from "../services/payment-processing";

const app = createContext(loadConfig());
try {
  const sent = await app.notifications.dispatchPending(200);
  const expired = await expireStaleAttempts(app);
  const props = await app.db
    .update(proposals)
    .set({ status: "expired" })
    .where(and(inArray(proposals.status, ["sent", "viewed"]), lt(proposals.expiresAt, new Date())))
    .returning({ id: proposals.id });
  const drafts = await app.db
    .delete(configuratorDrafts)
    .where(and(isNull(configuratorDrafts.submittedAt), lt(configuratorDrafts.expiresAt, new Date())))
    .returning({ id: configuratorDrafts.id });
  app.logger.info({ sent, expiredAttempts: expired, expiredProposals: props.length, deletedDrafts: drafts.length }, "jobs complete");
} finally {
  await app.dbHandle.close();
}

/** Spec Appendix A event taxonomy. */
export const ANALYTICS_EVENTS = [
  "portfolio_project_viewed",
  "package_viewed",
  "configurator_started",
  "configurator_step_completed",
  "configurator_abandoned",
  "configurator_submitted",
  "estimate_generated",
  "discovery_checkout_started",
  "discovery_purchased",
  "proposal_created",
  "proposal_sent",
  "proposal_viewed",
  "proposal_accepted",
  "checkout_started",
  "payment_succeeded",
  "payment_failed",
  "invoice_paid",
  "project_milestone_completed",
  "change_request_submitted",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Events the browser may report (only after analytics consent). The rest are emitted server-side. */
export const CLIENT_ANALYTICS_EVENTS: readonly AnalyticsEvent[] = [
  "portfolio_project_viewed",
  "package_viewed",
  "configurator_started",
  "configurator_step_completed",
  "configurator_abandoned",
];

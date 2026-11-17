/**
 * Business state machines with stable internal keys. Every status change in the
 * API goes through `assertTransition` so illegal jumps are impossible.
 */

export class TransitionError extends Error {
  constructor(public readonly machine: string, public readonly from: string, public readonly to: string) {
    super(`Illegal ${machine} transition: ${from} → ${to}`);
    this.name = "TransitionError";
  }
}

function machine<S extends string>(name: string, transitions: Record<S, readonly S[]>) {
  return {
    name,
    states: Object.keys(transitions) as S[],
    can(from: S, to: S) {
      return from === to || (transitions[from] ?? []).includes(to);
    },
    assert(from: S, to: S) {
      if (!this.can(from, to)) throw new TransitionError(name, from, to);
    },
    next(from: S): readonly S[] {
      return transitions[from] ?? [];
    },
  };
}

export const LEAD_STATUSES = ["new", "contacted", "qualified", "discovery_proposed", "proposal_sent", "won", "lost", "nurture"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  discovery_proposed: "Discovery proposed",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};
// CRM pipelines are fluid: any open status may move to any other; closed leads can be reopened.
export const leadMachine = machine<LeadStatus>("lead", {
  new: ["contacted", "qualified", "discovery_proposed", "proposal_sent", "won", "lost", "nurture"],
  contacted: ["new", "qualified", "discovery_proposed", "proposal_sent", "won", "lost", "nurture"],
  qualified: ["contacted", "discovery_proposed", "proposal_sent", "won", "lost", "nurture"],
  discovery_proposed: ["qualified", "proposal_sent", "won", "lost", "nurture"],
  proposal_sent: ["qualified", "discovery_proposed", "won", "lost", "nurture"],
  won: ["proposal_sent", "nurture"],
  lost: ["new", "contacted", "nurture"],
  nurture: ["new", "contacted", "qualified", "lost"],
});

export const PROPOSAL_STATUSES = ["draft", "sent", "viewed", "accepted", "declined", "superseded", "expired", "withdrawn"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const proposalMachine = machine<ProposalStatus>("proposal", {
  draft: ["sent", "withdrawn", "superseded"],
  sent: ["viewed", "accepted", "declined", "superseded", "expired", "withdrawn"],
  viewed: ["accepted", "declined", "superseded", "expired", "withdrawn"],
  accepted: [],
  declined: ["superseded"],
  superseded: [],
  expired: ["superseded"],
  withdrawn: ["superseded"],
});

export const ORDER_STATUSES = ["pending_payment", "confirmed", "in_progress", "completed", "cancelled", "refunded", "partially_refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderMachine = machine<OrderStatus>("order", {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "completed", "cancelled", "refunded", "partially_refunded"],
  in_progress: ["completed", "cancelled", "refunded", "partially_refunded"],
  completed: ["refunded", "partially_refunded"],
  cancelled: [],
  refunded: [],
  partially_refunded: ["refunded", "completed", "in_progress"],
});

export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "void", "refunded", "partially_refunded"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const invoiceMachine = machine<InvoiceStatus>("invoice", {
  draft: ["issued", "void"],
  issued: ["partially_paid", "paid", "void"],
  partially_paid: ["paid", "void", "partially_refunded"],
  paid: ["refunded", "partially_refunded"],
  void: [],
  refunded: [],
  partially_refunded: ["refunded"],
});

export const PAYMENT_ATTEMPT_STATUSES = ["created", "redirected", "pending_verification", "succeeded", "failed", "cancelled", "expired"] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];
export const paymentAttemptMachine = machine<PaymentAttemptStatus>("payment_attempt", {
  created: ["redirected", "pending_verification", "succeeded", "failed", "cancelled", "expired"],
  redirected: ["pending_verification", "succeeded", "failed", "cancelled", "expired"],
  pending_verification: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  // A late, verified success after a failure/cancel notice is still accepted (out-of-order webhooks).
  failed: ["succeeded"],
  cancelled: ["succeeded"],
  expired: ["succeeded"],
});

export const PROJECT_STATUSES = ["awaiting_deposit", "not_started", "in_progress", "on_hold", "in_review", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  awaiting_deposit: "Awaiting deposit",
  not_started: "Ready to start",
  in_progress: "In progress",
  on_hold: "On hold",
  in_review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const projectMachine = machine<ProjectStatus>("project", {
  awaiting_deposit: ["not_started", "in_progress", "cancelled", "on_hold"],
  not_started: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["on_hold", "in_review", "completed", "cancelled"],
  on_hold: ["in_progress", "not_started", "cancelled"],
  in_review: ["in_progress", "completed", "on_hold"],
  completed: ["in_progress"],
  cancelled: [],
});

export const MILESTONE_STATUSES = ["pending", "in_progress", "awaiting_approval", "completed"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const milestoneMachine = machine<MilestoneStatus>("milestone", {
  pending: ["in_progress", "completed"],
  in_progress: ["pending", "awaiting_approval", "completed"],
  awaiting_approval: ["in_progress", "completed"],
  completed: ["in_progress"],
});

export const CHANGE_REQUEST_STATUSES = ["open", "triaged", "quoted", "approved", "rejected", "in_progress", "resolved", "closed"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];
export const changeRequestMachine = machine<ChangeRequestStatus>("change_request", {
  open: ["triaged", "quoted", "rejected", "in_progress", "resolved", "closed"],
  triaged: ["quoted", "approved", "rejected", "in_progress", "resolved", "closed"],
  quoted: ["approved", "rejected", "closed"],
  approved: ["in_progress", "resolved", "closed"],
  rejected: ["open", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
});

/** Project may only move into active delivery when the deposit is settled or an audited exception exists. */
export function canStartWork(project: { depositRequired: boolean; depositPaid: boolean; depositExceptionReason: string | null }): boolean {
  return !project.depositRequired || project.depositPaid || Boolean(project.depositExceptionReason?.trim());
}

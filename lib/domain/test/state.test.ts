import { describe, expect, it } from "vitest";
import { proposalMachine, paymentAttemptMachine, projectMachine, canStartWork, TransitionError, invoiceMachine } from "../src/state";
import { hasPermission, canAssignRole } from "../src/permissions";

describe("state machines", () => {
  it("prevents re-opening an accepted proposal", () => {
    expect(() => proposalMachine.assert("accepted", "sent")).toThrow(TransitionError);
    expect(proposalMachine.can("sent", "accepted")).toBe(true);
  });
  it("accepts a late verified success after a failure notice", () => {
    expect(paymentAttemptMachine.can("failed", "succeeded")).toBe(true);
    expect(paymentAttemptMachine.can("succeeded", "failed")).toBe(false);
  });
  it("does not let a void invoice be paid", () => {
    expect(invoiceMachine.can("void", "paid")).toBe(false);
  });
  it("cancelled projects are terminal", () => {
    expect(projectMachine.next("cancelled")).toEqual([]);
  });
  it("blocks work until the deposit is paid or an exception is recorded", () => {
    expect(canStartWork({ depositRequired: true, depositPaid: false, depositExceptionReason: null })).toBe(false);
    expect(canStartWork({ depositRequired: true, depositPaid: false, depositExceptionReason: "  " })).toBe(false);
    expect(canStartWork({ depositRequired: true, depositPaid: false, depositExceptionReason: "Long-standing client, approved by owner" })).toBe(true);
    expect(canStartWork({ depositRequired: true, depositPaid: true, depositExceptionReason: null })).toBe(true);
  });
});

describe("permissions", () => {
  it("clients have no console permissions", () => {
    expect(hasPermission("client", "console.access")).toBe(false);
  });
  it("staff cannot refund or change pricing", () => {
    expect(hasPermission("staff", "payments.refund")).toBe(false);
    expect(hasPermission("staff", "pricing.manage")).toBe(false);
  });
  it("finance can refund, admin cannot approve pricing, owner can", () => {
    expect(hasPermission("finance", "payments.refund")).toBe(true);
    expect(hasPermission("admin", "pricing.approve")).toBe(false);
    expect(hasPermission("owner", "pricing.approve")).toBe(true);
  });
  it("admins cannot grant admin or owner", () => {
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "staff")).toBe(true);
    expect(canAssignRole("staff", "client")).toBe(false);
  });
});

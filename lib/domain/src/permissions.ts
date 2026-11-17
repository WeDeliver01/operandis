/**
 * Role-based access control. Checked server-side on every request; the UI uses
 * the same matrix only to decide what to show (hiding a button is not authorisation).
 */

export const ROLES = ["client", "staff", "finance", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES: readonly Role[] = ["staff", "finance", "admin", "owner"];

export const PERMISSIONS = [
  "console.access",
  "dashboard.read",
  "leads.read_assigned",
  "leads.read_all",
  "leads.write",
  "leads.assign",
  "submissions.read",
  "packages.manage",
  "pricing.manage",
  "pricing.approve",
  "content.manage",
  "proposals.manage",
  "orders.read",
  "orders.manage",
  "invoices.read",
  "invoices.manage",
  "payments.read",
  "payments.confirm_offline",
  "payments.refund",
  "projects.read_assigned",
  "projects.read_all",
  "projects.manage",
  "projects.deposit_exception",
  "requests.manage",
  "users.read",
  "users.manage",
  "roles.manage",
  "settings.manage",
  "settings.high_risk",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF: Permission[] = [
  "console.access",
  "dashboard.read",
  "leads.read_assigned",
  "leads.write",
  "submissions.read",
  "proposals.manage",
  "orders.read",
  "invoices.read",
  "projects.read_assigned",
  "projects.manage",
  "requests.manage",
];

const FINANCE: Permission[] = [
  "console.access",
  "dashboard.read",
  "orders.read",
  "orders.manage",
  "invoices.read",
  "invoices.manage",
  "payments.read",
  "payments.confirm_offline",
  "payments.refund",
  "projects.read_all",
  "users.read",
];

const ADMIN: Permission[] = [
  ...new Set<Permission>([
    ...STAFF,
    ...FINANCE,
    "leads.read_all",
    "leads.assign",
    "packages.manage",
    "pricing.manage",
    "content.manage",
    "projects.read_all",
    "projects.deposit_exception",
    "users.read",
    "users.manage",
    "settings.manage",
    "audit.read",
  ]),
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  client: [],
  staff: STAFF,
  finance: FINANCE,
  admin: ADMIN,
  owner: PERMISSIONS,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

/** Only owners may grant admin/owner; admins may manage client/staff/finance. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "client" || target === "staff" || target === "finance";
  return false;
}

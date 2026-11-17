/**
 * Create (or promote) the first owner account.
 *   pnpm --filter @workspace/api-server run create-admin -- --email you@example.com --name "Your Name" [--role owner]
 * Prints a one-time password-setup link (valid 7 days). No password is ever passed on the command line.
 */
import { eq } from "drizzle-orm";
import { users } from "@workspace/db";
import type { Role } from "@workspace/domain";
import { loadConfig } from "../config/env";
import { createContext } from "../context";
import { createAuthToken, findOrCreateClient } from "../services/accounts";
import { audit } from "../services/audit";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = arg("email");
const name = arg("name") ?? "Owner";
const role = (arg("role") ?? "owner") as Role;
if (!email || !["owner", "admin", "staff", "finance"].includes(role)) {
  console.error("Usage: create-admin --email <email> [--name <name>] [--role owner|admin|staff|finance]");
  process.exit(1);
}
const app = createContext(loadConfig());
try {
  const link = await app.db.transaction(async (tx) => {
    const business = await app.settings.get("business", tx);
    const c = await findOrCreateClient(tx, { email, name, company: business.tradingName });
    await tx.update(users).set({ role, name, emailVerifiedAt: new Date() }).where(eq(users.id, c.userId));
    const token = await createAuthToken(tx, c.userId, "invite");
    await audit(tx, null, { action: "user.bootstrap_admin", entityType: "user", entityId: c.userId, after: { email, role } });
    return `${app.config.PUBLIC_WEB_URL}/auth/reset?token=${token}&invite=1`;
  });
  console.log(`\n${role} account ready for ${email}.\nSet a password (link valid 7 days):\n\n  ${link}\n`);
} finally {
  await app.dbHandle.close();
}

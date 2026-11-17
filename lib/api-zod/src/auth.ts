import { z } from "zod/v4";
import { ROLES } from "@workspace/domain";
import { email, name, phone } from "./common";

export const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), "Use letters and at least one number");

export const registerBody = z.object({
  name,
  email,
  password,
  company: z.string().trim().max(160).optional(),
  phone: phone.optional(),
});
export const loginBody = z.object({ email, password: z.string().min(1).max(200), mfaCode: z.string().trim().regex(/^\d{6}$/).optional() });
export const emailOnlyBody = z.object({ email });
export const tokenBody = z.object({ token: z.string().min(20).max(200) });
export const resetPasswordBody = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });
export const mfaCodeBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

export const meSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  role: z.enum(ROLES),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  mfaRequired: z.boolean(),
  mfaVerified: z.boolean(),
  permissions: z.array(z.string()),
  organizations: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.string() })),
  notificationPrefs: z.object({ emailProjectUpdates: z.boolean(), emailInvoices: z.boolean(), emailMarketing: z.boolean() }),
});
export type Me = z.infer<typeof meSchema>;

export const updateProfileBody = z.object({
  name: name.optional(),
  phone: phone.nullable().optional(),
  notificationPrefs: z
    .object({ emailProjectUpdates: z.boolean(), emailInvoices: z.boolean(), emailMarketing: z.boolean() })
    .optional(),
});

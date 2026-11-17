import { z } from "zod/v4";

export const uuid = z.uuid();
export const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens").min(2).max(80);
export const optionKey = z.string().regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores").min(1).max(64);
export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const name = z.string().trim().min(1, "Required").max(120);
export const phone = z.string().trim().max(40).regex(/^[+0-9 ()-]*$/, "Use digits, spaces and + only");
export const minorAmount = z.number().int("Amounts are whole cents").min(0).max(100_000_000_00);
export const bps = z.number().int().min(0).max(10_000);
export const stringList = z.array(z.string().trim().min(1).max(500)).max(60);
export const isoDate = z.iso.datetime({ offset: true });
/** Honeypot: real users never fill this hidden field. */
export const honeypot = z.string().max(0, "Spam check failed").optional();

export const paginationQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(2).optional(),
});

export const okSchema = z.object({ ok: z.literal(true) });

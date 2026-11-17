import multer from "multer";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { paymentAttempts, projectFiles, projects } from "@workspace/db";
import { hasPermission, isStaffRole } from "@workspace/domain";
import { fileMetaBody, okSchema } from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, notFound } from "../lib/errors";
import { randomToken, sha256 } from "../lib/crypto";
import { limits } from "../middleware/rate-limit";
import { audit } from "../services/audit";
import { assertOrgAccess } from "../services/accounts";
import { sanitizeFileName, sniffFileType, verifyLocalSignature } from "../services/storage";
import type { AppContext } from "../context";

const LINK_TTL_SECONDS = 300;

export function fileRoutes(app: AppContext): RouteDef[] {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: app.config.FILE_MAX_BYTES, files: 1, fields: 10 } });
  const uploadLimit = limits.upload();

  async function loadFileFor(auth: NonNullable<Parameters<typeof requireUser>[0]>, id: string) {
    const [f] = await app.db.select().from(projectFiles).where(eq(projectFiles.id, id));
    if (!f || f.deletedAt) throw notFound("File");
    if (isStaffRole(auth.user.role)) {
      if (!hasPermission(auth.user.role, "projects.read_all") && !hasPermission(auth.user.role, "projects.read_assigned") && !hasPermission(auth.user.role, "payments.read")) throw notFound("File");
      return f;
    }
    if (f.visibility !== "client") throw notFound("File");
    await assertOrgAccess(app.db, auth.user.id, f.organizationId, "File");
    return f;
  }

  return [
    defineRoute({
      method: "post",
      path: "/files",
      summary: "Upload a file (multipart field `file`). Type verified by content; stored privately.",
      tags: ["files"],
      auth: "user",
      middleware: [uploadLimit, upload.single("file")],
      successStatus: 201,
      description: "Form fields: projectId?, kind?, visibility?, description?, attemptId? (EFT proof).",
      handler: async ({ req, auth }) => {
        const a = requireUser(auth);
        const meta = fileMetaBody.safeParse(req.body ?? {});
        if (!meta.success) throw new AppError(400, "validation_failed", "Invalid upload fields.");
        const file = req.file;
        if (!file) throw new AppError(400, "bad_request", "Attach a file in the `file` field.");
        const sniffed = sniffFileType(file.buffer, file.originalname);
        if (!sniffed) throw new AppError(415 as number, "bad_request", "That file type isn't allowed. Use PDF, images, Office documents, ZIP, TXT or CSV.");
        const staff = isStaffRole(a.user.role);

        let organizationId: string;
        let projectId: string | null = null;
        let attemptId: string | null = null;
        if (meta.data.attemptId) {
          const [att] = await app.db.select().from(paymentAttempts).where(eq(paymentAttempts.id, meta.data.attemptId));
          if (!att || att.provider !== "eft") throw notFound("Payment");
          if (!staff) await assertOrgAccess(app.db, a.user.id, att.organizationId, "Payment");
          organizationId = att.organizationId;
          attemptId = att.id;
        } else if (meta.data.projectId) {
          const [p] = await app.db.select().from(projects).where(eq(projects.id, meta.data.projectId));
          if (!p) throw notFound("Project");
          if (staff) {
            if (!hasPermission(a.user.role, "projects.manage")) throw notFound("Project");
          } else await assertOrgAccess(app.db, a.user.id, p.organizationId, "Project");
          organizationId = p.organizationId;
          projectId = p.id;
        } else throw new AppError(422, "validation_failed", "Specify the project (or payment) this file belongs to.");

        const kind = attemptId ? "eft_proof" : staff ? (meta.data.kind ?? "deliverable") : "client_upload";
        const visibility = staff ? (meta.data.visibility ?? "client") : "client";
        const objectKey = `org/${organizationId}/${projectId ?? "payments"}/${randomToken(16)}.${sniffed.ext}`;
        await app.storage.put(objectKey, file.buffer, sniffed.mime);
        const row = await app.db.transaction(async (tx) => {
          const [f] = await tx
            .insert(projectFiles)
            .values({
              organizationId,
              projectId,
              uploaderId: a.user.id,
              objectKey,
              fileName: sanitizeFileName(file.originalname),
              mimeType: sniffed.mime,
              sizeBytes: file.size,
              sha256: sha256(file.buffer),
              kind,
              visibility,
              description: meta.data.description ?? "",
            })
            .returning();
          if (attemptId) {
            const [att] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
            if (["created", "redirected"].includes(att.status)) {
              await tx.update(paymentAttempts).set({ status: "pending_verification", proofFileId: f.id }).where(eq(paymentAttempts.id, attemptId));
            } else {
              await tx.update(paymentAttempts).set({ proofFileId: f.id }).where(eq(paymentAttempts.id, attemptId));
            }
            await app.notifications.queueStaff(tx, { template: "payment.eft_pending", data: { reference: att.reference, amountMinor: att.amountMinor, path: `/admin/payments?attempt=${att.id}` }, dedupeKey: `eft-proof:${att.id}:${f.id}` });
          }
          await audit(tx, req, { action: "file.uploaded", entityType: "project_file", entityId: f.id, after: { kind, visibility, sizeBytes: file.size, mime: sniffed.mime } });
          return f;
        });
        void app.notifications.dispatchPending();
        return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, kind: row.kind, visibility: row.visibility, createdAt: row.createdAt };
      },
    }),
    defineRoute({
      method: "get",
      path: "/files/:id/download-url",
      summary: "Short-lived signed download link (ownership checked)",
      tags: ["files"],
      auth: "user",
      params: z.object({ id: z.uuid() }),
      response: z.object({ url: z.string(), expiresInSeconds: z.number() }),
      handler: async ({ params, auth, req }) => {
        const a = requireUser(auth);
        const f = await loadFileFor(a, params.id);
        await audit(app.db, req, { action: "file.download_link", entityType: "project_file", entityId: f.id });
        return { url: await app.storage.signedUrl(f.objectKey, { fileName: f.fileName, contentType: f.mimeType, ttlSeconds: LINK_TTL_SECONDS }), expiresInSeconds: LINK_TTL_SECONDS };
      },
    }),
    defineRoute({
      method: "post",
      path: "/files/:id/approve",
      summary: "Client approves a delivered file",
      tags: ["files"],
      auth: "user",
      params: z.object({ id: z.uuid() }),
      response: okSchema,
      handler: async ({ params, auth, req }) => {
        const a = requireUser(auth);
        const f = await loadFileFor(a, params.id);
        if (f.kind !== "deliverable") throw new AppError(422, "unprocessable", "Only deliverables can be approved.");
        await app.db.update(projectFiles).set({ approvedAt: new Date() }).where(and(eq(projectFiles.id, f.id)));
        await audit(app.db, req, { action: "file.approved", entityType: "project_file", entityId: f.id });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "delete",
      path: "/files/:id",
      summary: "Soft-delete a file (staff, or the client who uploaded it)",
      tags: ["files"],
      auth: "user",
      params: z.object({ id: z.uuid() }),
      response: okSchema,
      handler: async ({ params, auth, req }) => {
        const a = requireUser(auth);
        const f = await loadFileFor(a, params.id);
        if (!isStaffRole(a.user.role) && f.uploaderId !== a.user.id) throw notFound("File");
        await app.db.update(projectFiles).set({ deletedAt: new Date() }).where(eq(projectFiles.id, f.id));
        await audit(app.db, req, { action: "file.deleted", entityType: "project_file", entityId: f.id });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "get",
      path: "/files/blob",
      summary: "Serve a locally stored object via a signed link (local storage driver only)",
      tags: ["files"],
      auth: "public",
      query: z.object({ key: z.string().max(300), exp: z.coerce.number().int(), sig: z.string().max(100), name: z.string().max(200).default("file") }),
      rawResponse: { contentType: "application/octet-stream" },
      handler: async ({ query, res }) => {
        if (app.storage.name !== "local" || !verifyLocalSignature(app.config.APP_SECRET, query.key, query.exp, query.sig)) throw notFound("File");
        const [f] = await app.db.select({ mimeType: projectFiles.mimeType, fileName: projectFiles.fileName }).from(projectFiles).where(eq(projectFiles.objectKey, query.key));
        if (!f) throw notFound("File");
        const data = await app.storage.get(query.key);
        res.setHeader("content-type", f.mimeType);
        res.setHeader("content-disposition", `attachment; filename="${f.fileName.replace(/["\\\r\n]/g, "_")}"`);
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("cache-control", "private, no-store");
        res.send(data);
      },
    }),
  ];
}

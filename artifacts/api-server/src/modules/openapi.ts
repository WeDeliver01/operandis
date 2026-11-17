import { z } from "zod/v4";
import { defineRoute, routeRegistry, toOpenApiPath, type RouteDef } from "../lib/route";
import { problemSchema } from "@workspace/api-zod";
import type { AppContext } from "../context";

function schemaOf(s: z.ZodType | undefined, io: "input" | "output") {
  if (!s) return undefined;
  try {
    const json = z.toJSONSchema(s, { io, unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>;
    delete json.$schema;
    return json;
  } catch {
    return { type: "object" };
  }
}

/** Build an OpenAPI 3.1 document from the live route registry (the same Zod schemas used for validation). */
export function buildOpenApi(version = "1.0.0") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of [...routeRegistry].sort((a, b) => a.path.localeCompare(b.path))) {
    const path = toOpenApiPath(r.path);
    const op: Record<string, unknown> = {
      summary: r.summary,
      tags: r.tags,
      operationId: `${r.method}_${r.path.replace(/^\/api\/v1\//, "").replace(/[/:{}-]+/g, "_").replace(/_+$/, "")}`,
    };
    if (r.description) op.description = r.description;
    const level = r.permission ? "staff" : r.auth;
    if (level !== "public") {
      op.security = [{ sessionCookie: [], csrfToken: [] }];
      op["x-required-role"] = level === "staff" ? "staff" : "any signed-in user";
      if (r.permission) op["x-permissions"] = Array.isArray(r.permission) ? r.permission : [r.permission];
    }
    const parameters: unknown[] = [];
    const paramSchema = schemaOf(r.params, "input") as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    for (const name of r.path.match(/:([A-Za-z0-9_]+)/g)?.map((m) => m.slice(1)) ?? []) {
      parameters.push({ name, in: "path", required: true, schema: paramSchema?.properties?.[name] ?? { type: "string" } });
    }
    const q = schemaOf(r.query, "input") as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    for (const [name, schema] of Object.entries(q?.properties ?? {})) {
      parameters.push({ name, in: "query", required: q?.required?.includes(name) ?? false, schema });
    }
    if (parameters.length) op.parameters = parameters;
    if (r.body) {
      op.requestBody = { required: true, content: { "application/json": { schema: schemaOf(r.body, "input") } } };
    }
    if (r.path.endsWith("/files") && r.method === "post") {
      op.requestBody = { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" }, projectId: { type: "string" }, kind: { type: "string" }, visibility: { type: "string" }, description: { type: "string" }, attemptId: { type: "string" } }, required: ["file"] } } } };
    }
    const ok = String(r.successStatus ?? 200);
    const responses: Record<string, unknown> = {};
    if (r.rawResponse) responses[ok] = { description: "OK", content: { [r.rawResponse.contentType]: { schema: { type: "string", format: "binary" } } } };
    else responses[ok] = { description: "OK", content: { "application/json": { schema: schemaOf(r.response, "output") ?? { type: "object" } } } };
    responses.default = { description: "Error (RFC 9457 problem details)", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
    op.responses = responses;
    (paths[path] ??= {})[r.method] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Operandis Platform API",
      version,
      description:
        "Lead-to-cash API for the Operandis software studio: catalogue, configurator & estimates, CRM, proposals, checkout & payments, client portal and operations console. " +
        "Cookie session auth (HttpOnly `op_session`) with double-submit CSRF: send the `op_csrf` cookie value in the `x-csrf-token` header on every non-GET request. " +
        "Money is integer minor units (ZAR cents). Errors are application/problem+json with a stable `code`.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "op_session" },
        csrfToken: { type: "apiKey", in: "header", name: "x-csrf-token" },
      },
      schemas: { Problem: schemaOf(problemSchema, "output") },
    },
    paths,
  };
}

export function openApiRoutes(_app: AppContext): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/openapi.json",
      summary: "This API's OpenAPI 3.1 document",
      tags: ["meta"],
      auth: "public",
      handler: () => buildOpenApi(),
    }),
  ];
}

# Single-origin production image: API + built SPA. Validate in CI before relying on it
# (it was authored alongside the code but not built in the development sandbox).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=5173 BASE_PATH=/ pnpm build
RUN pnpm --filter @workspace/api-server deploy --prod /out \
 && cp -r artifacts/api-server/dist /out/dist \
 && mkdir -p /out/web && cp -r artifacts/operandi/dist/public/. /out/web/

FROM node:22-bookworm-slim
ENV NODE_ENV=production API_PORT=8080 SERVE_WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out /app
RUN useradd --system --uid 10001 operandis && mkdir -p /app/.data && chown -R operandis /app/.data
USER operandis
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run `node dist/migrate.mjs` as a release step before starting new versions.
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

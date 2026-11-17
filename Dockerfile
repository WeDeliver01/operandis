# Operandis: API + built website in one image. Used by docker-compose.yml / deploy/deploy.sh.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=5173 BASE_PATH=/ pnpm build
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /out \
 && cp -r artifacts/api-server/dist /out/dist \
 && mkdir -p /out/web && cp -r artifacts/operandi/dist/public/. /out/web/

FROM node:22-bookworm-slim
LABEL app=operandis
ENV NODE_ENV=production API_PORT=8080 SERVE_WEB_DIST=/app/web STORAGE_LOCAL_DIR=/app/.data/files
WORKDIR /app
COPY --from=build /out /app
RUN useradd --system --uid 10001 operandis && mkdir -p /app/.data/files && chown -R operandis /app/.data
USER operandis
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY modules ./modules
COPY packages ./packages
RUN bun install --frozen-lockfile && bun run --filter @stream-overlay/web build && bun build apps/server/src/server.ts --target bun --outdir dist/server

FROM oven/bun:1.3.14-slim
WORKDIR /app
ENV PORT=8000 WEB_DIST=/app/apps/web/dist AUTH_DATA_DIR=/data/auth
COPY --from=build /app/dist/server/server.js /app/server.js
COPY --from=build /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data/auth && chown -R bun:bun /app /data
USER bun
EXPOSE 8000
CMD ["bun", "/app/server.js"]

FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY modules ./modules
COPY packages ./packages
COPY lexicons ./lexicons
COPY streamplace-pets ./streamplace-pets
RUN bun install --frozen-lockfile && bun run --filter @streamface/web build && bun build apps/server/src/server.ts --target bun --outdir dist/server

FROM oven/bun:1.4.2-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8000 WEB_DIST=/app/apps/web/dist AUTH_DATA_DIR=/data/auth
COPY --from=build /app/dist/server/server.js /app/server.js
COPY --from=build /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data/auth && chown -R bun:bun /app /data && chmod 0700 /data/auth
USER bun
EXPOSE 8000
CMD ["bun", "/app/server.js"]

FROM oven/bun:1.4.2 AS source
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY modules ./modules
COPY packages ./packages
COPY lexicons ./lexicons
RUN bun install --frozen-lockfile

# Opt-in target only: do not publish until upstream permission is documented.
FROM source AS pets-build
COPY streamplace-pets ./streamplace-pets
RUN VITE_ENABLE_CLOUD_PETS=true bun run --filter @streamface/web build && bun build apps/server/src/server.ts --target bun --outdir dist/server

FROM source AS build
RUN VITE_ENABLE_CLOUD_PETS=false bun run --filter @streamface/web build && bun build apps/server/src/server.ts --target bun --outdir dist/server

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8000 WEB_DIST=/app/apps/web/dist AUTH_DATA_DIR=/data/auth
RUN mkdir -p /data/auth && chown -R bun:bun /app /data && chmod 0700 /data/auth
USER bun
EXPOSE 8000
CMD ["bun", "/app/server.js"]

FROM runtime AS pets
ENV ENABLE_CLOUD_PETS=true
COPY --from=pets-build --chown=bun:bun /app/dist/server/server.js /app/server.js
COPY --from=pets-build --chown=bun:bun /app/apps/web/dist /app/apps/web/dist

# Default hosted image: no upstream Pets files or page.
FROM runtime AS hosted
ENV ENABLE_CLOUD_PETS=false
COPY --from=build --chown=bun:bun /app/dist/server/server.js /app/server.js
COPY --from=build --chown=bun:bun /app/apps/web/dist /app/apps/web/dist

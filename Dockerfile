# syntax=docker/dockerfile:1

# ---- build: compile TypeScript, then drop dev dependencies ----
FROM node:26.11.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries (prebuilds/linux-x64.node); skipping scripts avoids
# npm's implicit `node-gyp rebuild`, which would need a compiler toolchain in the image.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---- runtime: only compiled JS + production dependencies, non-root ----
FROM node:26.11.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DB_PATH=/data/bot.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]

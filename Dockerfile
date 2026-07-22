# ── HEAVEN-GeoIntel — multi-stage Dockerfile ─────────────────────────────────
# Produces a production image of the Next.js app (~205 MB compressed, ~1 GB on
# disk — it ships the full node_modules; switching next.config.mjs to
# `output: "standalone"` is the lever if that needs to come down). The image
# runs as a non-root user, reads optional API keys from environment variables
# at runtime, and exposes port 3000.

# ── 1. dependency layer ──────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# devDependencies are required here — the builder stage runs `next build`.
# (This was `--omit=dev=false`, which npm rejects as invalid config and ignores.)
RUN npm ci --no-audit --no-fund --include=dev

# ── 2. build layer ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN node node_modules/next/dist/bin/next build

# ── 3. runtime layer ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 geointel

# Copy build output + minimal runtime files.
# `public/` is required, not optional: `next start` serves it from the working
# directory, and the brand assets referenced by the web manifest and the
# OpenAPI spec (/brand/*) 404 without it.
COPY --from=builder --chown=geointel:nodejs /app/.next ./.next
COPY --from=builder /app/public          ./public
COPY --from=builder /app/node_modules    ./node_modules
COPY --from=builder /app/package.json    ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

USER geointel
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]

# ── HEAVEN-GeoIntel — multi-stage Dockerfile ─────────────────────────────────
# Produces a small (<200 MB) production image of the Next.js app. The image
# runs as a non-root user, reads optional API keys from environment variables
# at runtime, and exposes port 3000.

# ── 1. dependency layer ──────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --omit=dev=false

# ── 2. build layer ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN node node_modules/next/dist/bin/next build

# ── 3. runtime layer ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 geointel

# Copy build output + minimal runtime files
COPY --from=builder --chown=geointel:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules    ./node_modules
COPY --from=builder /app/package.json    ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

USER geointel
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health -O /dev/null || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]

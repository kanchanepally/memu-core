# Memu Core — production image for HP Z2 / home deployment
# Joins the existing memu-suite Docker network alongside Synapse, Immich, Ollama etc.

FROM node:20-slim AS builder

# Build tools for native modules (@xenova/transformers -> onnxruntime, baileys)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (incl dev) so we can run `tsc`
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Trim to production deps for the runtime image
RUN npm prune --omit=dev

# ---------------------------------------------------------------
FROM node:20-slim AS runtime

# Runtime deps: openssl for pg, ca-certificates for outbound HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV TZ=Europe/London

# Copy built artefacts + production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# PWA assets are served from src/dashboard/public at runtime
COPY src/dashboard/public ./src/dashboard/public

# Baileys session + uploaded documents persistence
RUN mkdir -p /app/auth_info_baileys /app/documents
VOLUME ["/app/auth_info_baileys", "/app/documents"]

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

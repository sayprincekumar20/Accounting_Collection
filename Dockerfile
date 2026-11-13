# Rare Global Food - Collections dashboard (TanStack Start + Nitro, preset "node-server").
# Built and run by Dokploy (Build Type: Dockerfile). Listens on 0.0.0.0:3000; Dokploy/Traefik handles HTTPS.
# Secrets are NOT baked into the image: set them in Dokploy > Environment (see .env.example).

# ---- Stage 1: install and build ------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Stage 2: run ---------------------------------------------------------------------------------------
# .output is self-contained (Nitro bundles the server and copies the node_modules it needs).
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", ".output/server/index.mjs"]

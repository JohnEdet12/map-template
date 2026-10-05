# The geodata service: the cache database and the tools that fill it.
#
# The data this project depends on is far too big for git — a 145 MB SQLite
# database built from a 700 MB OpenStreetMap extract. Neither belongs in a
# repository, but both have to reach whoever runs the studio. So the database
# travels as a container image or a Docker volume instead, and this is what
# builds and serves it.
#
# One image, three jobs, chosen by the command:
#
#   cache-server.mjs   serve the database over HTTP        (the default)
#   import-pbf.mjs     build it from a local .osm.pbf
#   backup-db.mjs      take a consistent copy to hand over
#
# Node 24 for `node:sqlite`, which is built in — so there is no native module
# to compile and the image needs no build toolchain.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production only: vite, tailwind and postcss build the browser bundle and
# have no part in serving or importing data.
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app

# curl is here for the container healthcheck and for fetching extracts.
RUN apk add --no-cache curl

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# The importer reads the dataset catalogue and the cache-key helpers straight
# out of the browser source, which is exactly why the two cannot disagree
# about what a dataset is.
COPY server ./server
COPY src ./src

# The database lives on a volume, never in a layer, so it survives image
# rebuilds and can be backed up and moved on its own.
ENV CACHE_DB=/data/geodata.db \
    PORT=8788 \
    ALLOW_ORIGIN=http://localhost:5173 \
    NODE_OPTIONS=--max-old-space-size=8192
VOLUME ["/data"]
EXPOSE 8788

# Runs as the `node` user that the base image already provides.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["node", "server/cache-server.mjs"]

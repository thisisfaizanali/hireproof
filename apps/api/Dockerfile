# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t hireproof-api .
FROM node:26-bookworm-slim AS manifests
WORKDIR /app
# Every workspace manifest is needed so npm can check the lockfile, but only
# the API and the shared package are installed. The Prisma schema comes first
# because the API's postinstall step generates the client from it.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY tools/corpus/package.json tools/corpus/

# Production dependencies only, which is what the runtime stage carries.
FROM manifests AS prod-deps
RUN npm ci --omit=dev -w @hireproof/api -w @hireproof/shared  && npm cache clean --force

FROM manifests AS build
RUN npm ci -w @hireproof/api -w @hireproof/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w @hireproof/shared \
 && npm run build -w @hireproof/api \
 && npm prune --omit=dev --include-workspace-root \
 && npm cache clean --force

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
# Keep the process inside a 512 MB instance: cap the JavaScript heap, and stop
# glibc from giving every OCR thread its own memory arena.
ENV NODE_OPTIONS=--max-old-space-size=192
ENV MALLOC_ARENA_MAX=2
WORKDIR /app

# The workspace links in node_modules point at these folders, so they keep
# their paths. The English OCR data and the native PDF renderer are ordinary
# dependencies, so they arrive with node_modules and nothing is fetched at run time.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/prisma.config.ts apps/api/
COPY --from=build --chown=node:node /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist

USER node
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Migrations run on every start on purpose: Render's free plan has no
# pre-deploy step. migrate deploy only applies migrations that are not yet
# recorded, and takes a database lock, so a restart or a second instance is safe.
# If it fails the container exits and the deploy is marked failed. exec lets
# node receive SIGTERM directly.
CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy && exec node dist/server.js"]

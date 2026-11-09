# Production build of the web app, for running the whole product locally with
# docker compose. Vercel builds the hosted copy itself and does not use this file.
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t hireproof-web .
FROM node:26-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY packages/shared/package.json packages/shared/
COPY tools/corpus/package.json tools/corpus/
COPY tools/docs/package.json tools/docs/
RUN npm ci -w @hireproof/web -w @hireproof/shared --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# next.config reads the API address and the demo login settings while it
# builds, so they are build arguments as well as run-time settings.
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_DEMO_LOGINS=
ARG NEXT_PUBLIC_DEMO_PASSWORD=
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_PUBLIC_DEMO_LOGINS=$NEXT_PUBLIC_DEMO_LOGINS \
    NEXT_PUBLIC_DEMO_PASSWORD=$NEXT_PUBLIC_DEMO_PASSWORD \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @hireproof/shared && npm run build -w @hireproof/web \
 && chown -R node:node /app/apps/web/.next

ENV NODE_ENV=production
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start", "-p", "3000"]

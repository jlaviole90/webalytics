# syntax=docker/dockerfile:1.6
#
# Dockerfile for the demo Next.js app.
#
# Built from the repo root so we can COPY in the tracker packages too and
# have npm workspaces resolve them normally. Run with:
#   docker compose up demo-next

FROM node:20-alpine AS deps
WORKDIR /app
# Copy only what's needed for `npm install` to maximize cache hits.
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/tracker/package.json packages/tracker/
COPY packages/tracker-next/package.json packages/tracker-next/
COPY apps/demo-next/package.json apps/demo-next/
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
# NEXT_PUBLIC_* are inlined at build time. Default to the stable seed id so
# `make up` works without supplying anything; override via build-args when
# needed (see docker-compose.yml).
ARG NEXT_PUBLIC_WEBALYTICS_SITE_ID=wb_live_seedseedseedseed
ARG NEXT_PUBLIC_WEBALYTICS_HOST=http://localhost:8080
ENV NEXT_PUBLIC_WEBALYTICS_SITE_ID=$NEXT_PUBLIC_WEBALYTICS_SITE_ID
ENV NEXT_PUBLIC_WEBALYTICS_HOST=$NEXT_PUBLIC_WEBALYTICS_HOST
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps/demo-next ./apps/demo-next
# Build the local tracker packages first so Next sees their dist output.
RUN npm run build -w @jlaviole90/tracker
RUN npm run build -w @jlaviole90/tracker-next
# Next standalone output bundles its own minimal node_modules subset.
WORKDIR /app/apps/demo-next
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Standalone output is self-contained; copy it plus the static + public dirs.
COPY --from=build /app/apps/demo-next/.next/standalone ./
COPY --from=build /app/apps/demo-next/.next/static ./apps/demo-next/.next/static
EXPOSE 3000
CMD ["node", "apps/demo-next/server.js"]

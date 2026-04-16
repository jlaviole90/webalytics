# syntax=docker/dockerfile:1.6
#
# Dockerfile for the read-only dashboard app.
#
# Built from the repo root so npm workspaces resolve. Environment variables
# (WEBALYTICS_API_HOST, WEBALYTICS_API_TOKEN, WEBALYTICS_SITE_UUID) are read
# at runtime by server components, so they don't need to be build-time args.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY apps/dashboard-next/package.json apps/dashboard-next/
# Other workspace package.jsons are needed so `npm install` can resolve the
# workspace graph, even if we don't end up using them in the build.
COPY packages/tracker/package.json packages/tracker/
COPY packages/tracker-next/package.json packages/tracker-next/
COPY apps/demo-next/package.json apps/demo-next/
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/dashboard-next ./apps/dashboard-next
WORKDIR /app/apps/dashboard-next
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/dashboard-next/.next/standalone ./
COPY --from=build /app/apps/dashboard-next/.next/static ./apps/dashboard-next/.next/static
EXPOSE 3001
CMD ["node", "apps/dashboard-next/server.js"]

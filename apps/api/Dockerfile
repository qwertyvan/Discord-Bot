# syntax=docker/dockerfile:1.6
#
# Multi-stage build for @discord-bot/api. Uses the npm workspace at the repo
# root so the `@discord-bot/shared` package resolves correctly. Final image
# only carries production node_modules + compiled JS.

# ── deps stage: install full workspace dependencies ─────────────────────────
FROM node:20-alpine AS deps
WORKDIR /repo
ENV CI=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/

RUN npm ci --workspaces --include-workspace-root

# ── build stage: compile shared + api ───────────────────────────────────────
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @discord-bot/shared
RUN npx --workspace @discord-bot/api prisma generate
RUN npm run build --workspace @discord-bot/api

# ── runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Copy production node_modules and built artifacts only.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules

WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]

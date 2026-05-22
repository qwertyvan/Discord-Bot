# syntax=docker/dockerfile:1.6
#
# Multi-stage build for @discord-bot/bot. The bot has a runtime native dep
# (@napi-rs/canvas) so we install dev tooling in the deps stage but only ship
# production node_modules + compiled JS.

FROM node:20-alpine AS deps
WORKDIR /repo
ENV CI=1

# Native build tools for @napi-rs/canvas prebuilds; alpine usually pulls a
# musl prebuild but keep the fallbacks available.
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/

RUN npm ci --workspaces --include-workspace-root

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/bot apps/bot
RUN npm run build --workspace @discord-bot/shared
RUN npm run build --workspace @discord-bot/bot

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

RUN apk add --no-cache libc6-compat

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /repo/apps/bot/dist ./apps/bot/dist
COPY --from=build /repo/apps/bot/node_modules ./apps/bot/node_modules

# Plugins are mounted at runtime via compose so operators can drop in/out
# without rebuilding the image.
RUN mkdir -p /repo/plugins

WORKDIR /repo/apps/bot
CMD ["node", "dist/index.js"]

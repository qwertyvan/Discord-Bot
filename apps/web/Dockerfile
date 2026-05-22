# syntax=docker/dockerfile:1.6
#
# Multi-stage Next.js build for @discord-bot/web. Uses `next start` against
# the standard `.next` output. Switch to `output: 'standalone'` later if you
# want a smaller runtime image.

FROM node:20-alpine AS deps
WORKDIR /repo
ENV CI=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/

RUN npm ci --workspaces --include-workspace-root

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @discord-bot/shared
RUN npm run build --workspace @discord-bot/web

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build /repo/apps/web/.next ./apps/web/.next
COPY --from=build /repo/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=build /repo/apps/web/node_modules ./apps/web/node_modules

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "--port", "3000"]

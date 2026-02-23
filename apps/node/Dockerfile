FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/node/package.json apps/node/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /repo
COPY apps/node apps/node
COPY packages/shared packages/shared
COPY packages/config packages/config
RUN pnpm --filter @statix/shared build
RUN pnpm --filter @statix/node build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/apps/node/package.json /app/apps/node/package.json
COPY --from=build /repo/apps/node/dist /app/apps/node/dist
COPY --from=build /repo/apps/node/version.json /app/apps/node/version.json
COPY --from=build /repo/packages/shared/dist /app/packages/shared/dist
COPY --from=build /repo/packages/shared/package.json /app/packages/shared/package.json

CMD ["node", "apps/node/dist/index.js"]

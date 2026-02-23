FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /repo
COPY apps/web apps/web
COPY packages/config packages/config
RUN pnpm --filter web build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/apps/web/node_modules /app/apps/web/node_modules
COPY --from=build /repo/apps/web/build /app/apps/web/build
COPY --from=build /repo/apps/web/package.json /app/apps/web/package.json

CMD ["node", "apps/web/build/index.js"]

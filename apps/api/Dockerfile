FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /repo
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/config packages/config
RUN pnpm --filter @statix/shared build
RUN pnpm --filter @statix/api prisma:generate
RUN pnpm --filter @statix/api build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /repo/apps/api/package.json /app/apps/api/package.json
COPY --from=build /repo/apps/api/dist /app/apps/api/dist
COPY --from=build /repo/apps/api/prisma /app/apps/api/prisma
COPY --from=build /repo/packages/shared/dist /app/packages/shared/dist
COPY --from=build /repo/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /repo/packages/shared/node_modules /app/packages/shared/node_modules

CMD ["node", "apps/api/dist/index.js"]

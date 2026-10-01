ARG SHADOWCOOK_BUILD_COMMIT

FROM node:24.13.0-alpine AS build

ARG SHADOWCOOK_BUILD_COMMIT

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
COPY initial-deployment-seed.json ./

RUN printf "export function buildCommit(): string | undefined {\n  return '%s';\n}\n" "${SHADOWCOOK_BUILD_COMMIT}" > apps/web/src/lib/server/build-info.ts \
    && pnpm build \
    && pnpm --filter @shadowcook/api --prod deploy --legacy /runtime/api \
    && pnpm --filter @shadowcook/web --prod deploy --legacy /runtime/web

FROM node:24.13.0-alpine AS api-runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /workspace/apps/api

COPY --from=build /runtime/api ./
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/initial-deployment-seed.json /workspace/initial-deployment-seed.json

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]

FROM node:24.13.0-alpine AS web-runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

WORKDIR /workspace/apps/web

COPY --from=build /runtime/web ./
COPY --from=build /workspace/apps/web/dist ./dist

USER node

EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]

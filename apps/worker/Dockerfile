FROM node:22-alpine
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/shell/package.json apps/shell/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/repacker/package.json packages/repacker/package.json
COPY packages/db/package.json packages/db/package.json
# packages/config and packages/db's full source must be present before `npm ci`, since
# their postinstall (tsup) needs real source files to build, not just the manifest —
# worker doesn't depend on @mobilio/db itself, but the root postinstall script builds
# it unconditionally for every workspace install.
COPY packages/config packages/config
COPY packages/db packages/db
RUN npm ci

COPY apps/worker apps/worker

WORKDIR /repo/apps/worker
CMD ["npx", "tsx", "src/index.ts"]

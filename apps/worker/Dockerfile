FROM node:22-alpine
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/shell/package.json apps/shell/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/repacker/package.json packages/repacker/package.json
# packages/config's full source must be present before `npm ci`, since its postinstall
# (tsup) needs real source files to build, not just the manifest.
COPY packages/config packages/config
RUN npm ci

COPY apps/worker apps/worker

WORKDIR /repo/apps/worker
CMD ["npx", "tsx", "src/index.ts"]

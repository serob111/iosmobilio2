FROM node:22-alpine
WORKDIR /repo

# Workspace manifests, for layer caching — npm ci at the root needs every member's
# package.json to resolve the lockfile tree even though this image only runs apps/api.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/shell/package.json apps/shell/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/repacker/package.json packages/repacker/package.json
COPY packages/db/package.json packages/db/package.json
# packages/config and packages/db's full source must be present before `npm ci`, since
# their postinstall (tsup) needs real source files to build, not just the manifest.
COPY packages/config packages/config
COPY packages/db packages/db
RUN npm ci

COPY apps/api apps/api
RUN npm run build --workspace=mobilio-api

WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]

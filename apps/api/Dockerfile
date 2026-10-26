# Build context: repository root (needs packages/domain).
FROM node:26-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN npm install --no-audit --no-fund --workspace @brookrege/api --workspace @brookrege/domain --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
# Type-checking happens in CI (npm run typecheck); the image build only transpiles,
# so a type-level nit can never stop the site from starting.
RUN npm run build -w @brookrege/domain && npm run build:docker -w @brookrege/api \
 && npm prune --omit=dev --workspace @brookrege/api --workspace @brookrege/domain

FROM node:26-alpine
RUN apk add --no-cache openssl tini ffmpeg && addgroup -S app && adduser -S app -G app
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/domain/package.json packages/domain/
COPY --from=build /repo/packages/domain/dist packages/domain/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY apps/api/docker-start.sh apps/api/docker-start.sh
# A Windows checkout can turn the script's line endings into CRLF, which stops it from running.
RUN tr -d '\r' < apps/api/docker-start.sh > /tmp/s && cat /tmp/s > apps/api/docker-start.sh && rm /tmp/s && mkdir -p /data/uploads && chown -R app:app /data && chmod +x apps/api/docker-start.sh
USER app
WORKDIR /repo/apps/api
ARG APP_VERSION=dev
ENV UPLOAD_DIR=/data/uploads PORT=4000 APP_VERSION=$APP_VERSION
# 4000 = API, 9464 = Prometheus metrics (publish only on the private network / 127.0.0.1)
EXPOSE 4000 9464
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-start.sh"]

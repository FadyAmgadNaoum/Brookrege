# Build context: repository root.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund --workspace @brookrege/web --workspace @brookrege/domain --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WHATSAPP_NUMBER
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @brookrege/domain && npm run build -w @brookrege/web

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Next.js standalone output leaves out public/ (icons, social image, home films and stills): copy it.
COPY --from=build /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

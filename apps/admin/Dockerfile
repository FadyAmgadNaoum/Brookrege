# Build context: repository root.
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/domain/package.json packages/domain/
COPY apps/admin/package.json apps/admin/
RUN npm install --no-audit --no-fund --workspace @brookrege/admin --workspace @brookrege/domain --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/admin apps/admin
ARG NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @brookrege/domain && npm run build -w @brookrege/admin

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
# Next.js standalone output leaves out public/ (icons, social image, sign-in photo): copy it.
COPY --from=build /repo/apps/admin/public ./apps/admin/public
USER app
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]

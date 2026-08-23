# ---- Build stage: install workspace deps and build API + web bundles ----
FROM node:24-alpine AS build
RUN npm install -g pnpm@11

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json .npmrc ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# vite.config.ts requires these at config load time even for a production build
ENV PORT=3000 BASE_PATH=/

RUN pnpm run build

# Prune to production dependencies only (the esbuild bundle externalizes nodemailer,
# so the runtime image needs a minimal node_modules next to the bundle).
RUN pnpm --filter @workspace/api-server deploy --prod /out

# ---- Runtime stage: API bundle + pruned deps + built web assets ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/web

WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/ticket-booking/dist/public ./web

EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

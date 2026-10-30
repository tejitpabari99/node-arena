# Build context = repo root: docker build -f apps/server/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @node-arena/defs --filter @node-arena/content --filter @node-arena/sim --filter @node-arena/bots --filter @node-arena/net --filter @node-arena/server... build \
 && pnpm --filter @node-arena/server deploy --prod --legacy /out \
 && mkdir -p /out/content-data \
 && cp -r packages/content/data /out/content-data/data \
 && cp packages/content/content.json /out/content-data/content.json

FROM node:22-slim
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=192 \
    PORT=8080 \
    CONTENT_DIR=/app/content-data/data
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]

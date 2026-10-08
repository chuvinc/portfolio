FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000

# Build metadata surfaced by /api/build-info
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthcheck || exit 1
CMD ["node", "src/server.js"]

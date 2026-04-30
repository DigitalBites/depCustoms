FROM node:22.22-alpine3.23 AS build
WORKDIR /build/services/api

COPY services/api/package*.json ./
RUN npm ci

COPY services/api/ ./
RUN npm run build

FROM node:22.22-alpine3.23 AS runtime
RUN apk add --no-cache bash ca-certificates tini wget \
    && addgroup -S customs \
    && adduser -S -G customs -h /app customs \
    && mkdir -p /app/api /app/data \
    && chown -R customs:customs /app

WORKDIR /app

COPY --from=build --chown=customs:customs /build/services/api/package*.json /app/api/
COPY --from=build --chown=customs:customs /build/services/api/node_modules /app/api/node_modules
COPY --from=build --chown=customs:customs /build/services/api/dist /app/api/dist
COPY --from=build --chown=customs:customs /build/services/api/drizzle /app/api/drizzle
COPY --from=build --chown=customs:customs /build/services/api/drizzle.config.ts /app/api/drizzle.config.ts

COPY --chown=customs:customs services/api/docker/container-entrypoint.sh /usr/local/bin/api-container-entrypoint.sh
COPY --chown=customs:customs services/api/docker/container-healthcheck.sh /usr/local/bin/api-container-healthcheck.sh

RUN chmod +x /usr/local/bin/api-container-entrypoint.sh /usr/local/bin/api-container-healthcheck.sh

ENV NODE_ENV=production
ENV DEPLOYMENT_MODE=all_in_one

USER customs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/api-container-entrypoint.sh"]

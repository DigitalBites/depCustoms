# syntax=docker/dockerfile:1.7

ARG NODE_BASE_IMAGE=node:22.22-alpine3.23
FROM ${NODE_BASE_IMAGE} AS build
WORKDIR /build/services/dashboard

COPY services/shared/constants /build/services/shared/constants
COPY services/dashboard/package*.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false npm ci

COPY services/dashboard/ ./
RUN mkdir -p public && npm run build

FROM ${NODE_BASE_IMAGE} AS runtime
RUN apk add --no-cache ca-certificates tini wget \
    && addgroup -S customs \
    && adduser -S -G customs -h /app customs \
    && mkdir -p /app/dashboard/.next \
    && chown -R customs:customs /app

WORKDIR /app

COPY --from=build --chown=customs:customs /build/services/dashboard/.next/standalone /app/dashboard
COPY --from=build --chown=customs:customs /build/services/dashboard/.next/static /app/dashboard/.next/static
COPY --from=build --chown=customs:customs /build/services/dashboard/public /app/dashboard/public
COPY --from=build --chown=customs:customs /build/services/shared/constants /app/shared/constants

ENV NODE_ENV=production

USER customs

WORKDIR /app/dashboard

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-lc", "exec node server.js"]

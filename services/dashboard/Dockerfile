FROM node:22.22-alpine3.23 AS build
WORKDIR /build/services/dashboard

COPY services/dashboard/package*.json ./
RUN npm ci

COPY services/dashboard/ ./
RUN mkdir -p public && npm run build

FROM node:22.22-alpine3.23 AS runtime
RUN apk add --no-cache ca-certificates tini wget \
    && addgroup -S customs \
    && adduser -S -G customs -h /app customs \
    && mkdir -p /app/dashboard/.next \
    && chown -R customs:customs /app

WORKDIR /app

COPY --from=build --chown=customs:customs /build/services/dashboard/.next/standalone /app/dashboard
COPY --from=build --chown=customs:customs /build/services/dashboard/.next/static /app/dashboard/.next/static
COPY --from=build --chown=customs:customs /build/services/dashboard/public /app/dashboard/public

ENV NODE_ENV=production

USER customs

WORKDIR /app/dashboard

EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-lc", "exec node server.js"]

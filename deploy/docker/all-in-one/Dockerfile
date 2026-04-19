FROM node:22.22-alpine3.23 AS api-build
WORKDIR /build/services/api
COPY services/api/package*.json ./
RUN npm ci
COPY services/api/ ./
RUN npm run build

FROM node:22.22-alpine3.23 AS api-prod-deps
WORKDIR /build/services/api
COPY services/api/package*.json ./
RUN npm ci --omit=dev

FROM node:22.22-alpine3.23 AS dashboard-build
WORKDIR /build/services/dashboard
COPY services/dashboard/package*.json ./
RUN npm ci
COPY services/dashboard/ ./
RUN mkdir -p public && npm run build

FROM golang:1.25-alpine AS proxy-build
WORKDIR /build/services/proxy
COPY services/proxy/go.mod services/proxy/go.sum ./
RUN go mod download
COPY services/proxy/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/proxy ./cmd/proxy

FROM golang:1.25.8-alpine3.23 AS gotrue-build
WORKDIR /build/third_party/supabase-auth
RUN apk add --no-cache make git
COPY third_party/supabase-auth/ ./
RUN make deps
RUN RELEASE_VERSION=v2.186.0 make build

FROM node:22.22-alpine3.23
RUN apk add --no-cache bash ca-certificates tini wget \
    && addgroup -S customs \
    && adduser -S -G customs -h /app customs \
    && mkdir -p /app/api /app/dashboard /app/data /app/gotrue/migrations /app/bin \
    && chown -R customs:customs /app

WORKDIR /app

COPY --from=api-build --chown=customs:customs /build/services/api/package*.json /app/api/
COPY --from=api-build --chown=customs:customs /build/services/api/node_modules /app/api/node_modules
COPY --from=api-build --chown=customs:customs /build/services/api/dist /app/api/dist
COPY --from=api-build --chown=customs:customs /build/services/api/drizzle /app/api/drizzle
COPY --from=api-build --chown=customs:customs /build/services/api/drizzle.config.ts /app/api/drizzle.config.ts
COPY --from=api-build --chown=customs:customs /build/services/api/src /app/api/src

COPY --from=dashboard-build --chown=customs:customs /build/services/dashboard /app/dashboard

COPY --from=proxy-build /out/proxy /app/bin/proxy
COPY --from=gotrue-build /build/third_party/supabase-auth/auth /app/bin/auth
COPY --from=gotrue-build /build/third_party/supabase-auth/migrations /app/gotrue/migrations

COPY --chown=customs:customs deploy/docker/all-in-one/entrypoint.sh /usr/local/bin/all-in-one-entrypoint.sh
COPY --chown=customs:customs deploy/docker/all-in-one/healthcheck.sh /usr/local/bin/all-in-one-healthcheck.sh

RUN chmod +x /usr/local/bin/all-in-one-entrypoint.sh /usr/local/bin/all-in-one-healthcheck.sh /app/bin/proxy /app/bin/auth

ENV NODE_ENV=production
ENV DEPLOYMENT_MODE=all_in_one
ENV GOTRUE_DB_MIGRATIONS_PATH=/app/gotrue/migrations

USER customs

EXPOSE 3000 3001 8080 9999

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/all-in-one-entrypoint.sh"]

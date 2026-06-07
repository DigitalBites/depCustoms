# syntax=docker/dockerfile:1.7

ARG GO_BASE_IMAGE=golang:1.25-alpine
ARG ALPINE_BASE_IMAGE=alpine:3.23

FROM ${GO_BASE_IMAGE} AS build
WORKDIR /build/services/proxy

ARG TARGETOS=linux
ARG TARGETARCH

RUN apk add --no-cache file git

COPY services/proxy/go.mod services/proxy/go.sum ./
RUN go mod download

COPY services/proxy/ ./
RUN target_os="${TARGETOS:-$(go env GOOS)}" \
    && target_arch="${TARGETARCH:-$(go env GOARCH)}" \
    && CGO_ENABLED=0 GOOS="${target_os}" GOARCH="${target_arch}" go build -o /out/customs-proxy ./cmd/proxy \
    && CGO_ENABLED=0 GOOS="${target_os}" GOARCH="${target_arch}" go build -o /out/customs-proxy-sim ./cmd/proxy-sim \
    && CGO_ENABLED=0 GOOS="${target_os}" GOARCH="${target_arch}" go build -o /out/customs-fake-osv ./cmd/fake-osv \
    && file /out/customs-proxy /out/customs-proxy-sim /out/customs-fake-osv

FROM ${ALPINE_BASE_IMAGE} AS runtime
RUN apk add --no-cache ca-certificates tini wget \
    && addgroup -S customs \
    && adduser -S -G customs -h /app customs \
    && mkdir -p /app/data \
    && chown -R customs:customs /app

WORKDIR /app

COPY --from=build --chown=customs:customs /out/ /usr/local/bin/

USER customs

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/customs-proxy"]

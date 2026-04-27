FROM golang:1.25-alpine AS build
WORKDIR /build/services/proxy

RUN apk add --no-cache git

COPY services/proxy/go.mod services/proxy/go.sum ./
RUN go mod download

COPY services/proxy/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/proxy ./cmd/proxy

FROM alpine:3.23 AS runtime
RUN apk add --no-cache ca-certificates tini wget \
    && addgroup -S customs \
    && adduser -S -G customs -h /app customs \
    && mkdir -p /app/data \
    && chown -R customs:customs /app

WORKDIR /app

COPY --from=build --chown=customs:customs /out/proxy /usr/local/bin/customs-proxy

USER customs

EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/customs-proxy"]

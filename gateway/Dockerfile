# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.26-alpine AS builder

RUN apk --no-cache add ca-certificates git

WORKDIR /build

# Cache dependency downloads separately from source compilation.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux \
    go build -ldflags="-w -s -extldflags '-static'" \
    -o /gateway ./cmd/server/

# ── Runtime stage ─────────────────────────────────────────────────────────────
# alpine rather than scratch so the compose healthcheck (busybox wget) works;
# still ~8 MB and no shell access is exposed by the service itself.
FROM alpine:3.20

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /gateway /gateway

EXPOSE 8080
ENTRYPOINT ["/gateway"]

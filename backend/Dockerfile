# syntax=docker/dockerfile:1

# ---- build stage ------------------------------------------------------------
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Cache module downloads separately from source so they aren't re-fetched on
# every source change.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Static binary: no CGo, stripped debug symbols.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/server

# ---- runtime stage ----------------------------------------------------------
# distroless/static-debian12:nonroot has no shell, no package manager, and
# runs as uid 65532 (nonroot) by default.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /server /server

# Render injects PORT at runtime; the server defaults to 8080 when unset.
EXPOSE 8080

ENTRYPOINT ["/server"]

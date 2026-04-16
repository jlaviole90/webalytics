# syntax=docker/dockerfile:1.7
# Multi-stage Docker build for the webalytics service.
# Final image is a distroless static binary.

FROM golang:1.22-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO disabled for a fully static binary; trim paths and strip debug info.
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/webalytics ./cmd/webalytics

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/webalytics /usr/local/bin/webalytics
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/webalytics"]

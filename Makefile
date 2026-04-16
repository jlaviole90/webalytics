# Makefile for webalytics.
#
# Conventions:
#   - `make up`     starts the full stack (postgres + clickhouse + redis + api)
#   - `make down`   stops it
#   - `make logs`   tails the api
#   - `make test`   runs unit tests
#   - `make e2e`    runs the end-to-end test against a running stack
#   - `make seed`   seeds an org + site + token + domain for manual curl tests
#   - `make fmt`    gofmt + goimports
#
# All targets assume a local docker and compose plugin.

.PHONY: up down restart logs ps build test test-race e2e seed fmt vet tidy

COMPOSE ?= docker compose

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down -v

restart: down up

logs:
	$(COMPOSE) logs -f api

ps:
	$(COMPOSE) ps

build:
	go build ./...

test:
	go test ./...

test-race:
	go test -race ./...

e2e:
	@echo "running e2e against http://localhost:8080 (assumes 'make up' is running)"
	go test -tags=e2e -count=1 -v ./test/e2e/...

seed:
	@./deploy/seed.sh

fmt:
	gofmt -s -w .

vet:
	go vet ./...

tidy:
	go mod tidy

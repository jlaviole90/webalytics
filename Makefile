# Makefile for webalytics.
#
# Core stack (Go api + postgres + clickhouse + redis):
#   make up         start the core stack
#   make down       stop everything (incl. demo) and wipe volumes
#   make logs       tail the api logs
#   make ps         list containers
#
# Demo app (Next.js dogfood site + tracker packages):
#   make up-demo    build + start demo on :3000 (adds to the core stack)
#   make demo-logs  tail the demo app's logs
#
# Go:
#   make build test test-race vet tidy
#   make e2e        Go e2e tests (against a running core stack + seeded db)
#
# JS (npm workspaces):
#   make js-install
#   make js-build   build both tracker packages
#   make js-test    vitest unit tests for the core tracker
#   make js-size    gzip-size gate for the UMD bundle
#
# Browser:
#   make browser-e2e   Playwright suite against demo on :3000
#
# Seed:
#   make seed       create org/site/domain/token and write deploy/.seeded.env
#                   (both Go e2e and browser e2e source this file)

.PHONY: up up-demo down restart logs demo-logs ps \
        build test test-race e2e seed fmt vet tidy \
        js-install js-build js-test js-size \
        browser-install browser-e2e

COMPOSE ?= docker compose

up:
	$(COMPOSE) up -d --build

up-demo:
	$(COMPOSE) --profile demo up -d --build

down:
	$(COMPOSE) --profile demo down -v

restart: down up

logs:
	$(COMPOSE) logs -f api

demo-logs:
	$(COMPOSE) logs -f demo-next

ps:
	$(COMPOSE) --profile demo ps

build:
	go build ./...

test:
	go test ./...

test-race:
	go test -race ./...

e2e:
	@echo "running Go e2e against http://localhost:8080 (assumes 'make up' + 'make seed')"
	go test -tags=e2e -count=1 -v ./test/e2e/...

seed:
	@./deploy/seed.sh

fmt:
	gofmt -s -w .

vet:
	go vet ./...

tidy:
	go mod tidy

# --- JS --------------------------------------------------------------------

js-install:
	npm install

js-build:
	npm run build -w @webalytics/tracker
	npm run build -w @webalytics/tracker-next

js-test:
	npm run test -w @webalytics/tracker

js-size:
	npm run size -w @webalytics/tracker

# --- Browser e2e -----------------------------------------------------------

browser-install:
	npm install -w webalytics-browser-e2e
	npm run install-browsers -w webalytics-browser-e2e

browser-e2e:
	@echo "running browser e2e against $${BASE_URL:-http://localhost:3000} (assumes 'make up-demo' + 'make seed')"
	npm run test -w webalytics-browser-e2e

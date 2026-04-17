# Makefile for webalytics.
#
# Core stack (Go api + postgres + clickhouse + redis):
#   make up         start the core stack
#   make down       stop everything (incl. demo) and wipe volumes
#   make logs       tail the api logs
#   make ps         list containers
#
# Demo apps (full dogfood loop):
#   make up-demo        build + start BOTH demo apps (writer on :3000,
#                       dashboard on :3001) alongside the core stack
#   make demo-logs      tail the tracker-writer app's logs
#   make dashboard-logs tail the dashboard app's logs
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

.PHONY: up up-demo down restart logs demo-logs dashboard-logs ps \
        build test test-race e2e seed reset-data fmt vet tidy \
        js-install js-build js-test js-size \
        browser-install browser-e2e \
        tf-init tf-plan tf-apply tf-destroy tf-output deploy prod-logs prod-ssh \
        provision public-token prod-public-token

COMPOSE ?= docker compose

# SSH helpers for all prod-* targets. Pass SSH_KEY=path/to/key to use an
# explicit identity file; defaults to the Terraform-provisioned key if
# it exists locally, otherwise relies on the caller's ssh-agent / config.
TF_SSH_KEY := infra/terraform/keys/webalytics_ed25519
ifneq ("$(wildcard $(TF_SSH_KEY))","")
SSH_KEY   ?= $(TF_SSH_KEY)
endif
SSH_OPTS  := $(if $(SSH_KEY),-i $(SSH_KEY),)
SSH       := ssh $(SSH_OPTS)

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

dashboard-logs:
	$(COMPOSE) logs -f dashboard-next

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

# Provision a new tenant (org + site + domains + token). See
# deploy/provision-site.sh for the full env-var contract; the most
# common invocation is:
#   make provision ORG_SLUG=acme ORG_NAME="Acme" SITE_NAME="Acme" DOMAINS="acme.com"
provision:
	@test -n "$(ORG_SLUG)" || (echo "ORG_SLUG=... ORG_NAME=... SITE_NAME=... DOMAINS=... make provision" && exit 1)
	@test -n "$(ORG_NAME)" || (echo "ORG_NAME required" && exit 1)
	@test -n "$(SITE_NAME)" || (echo "SITE_NAME required" && exit 1)
	@test -n "$(DOMAINS)" || (echo "DOMAINS required" && exit 1)
	ORG_SLUG=$(ORG_SLUG) ORG_NAME="$(ORG_NAME)" SITE_NAME="$(SITE_NAME)" DOMAINS="$(DOMAINS)" bash deploy/provision-site.sh

# Mint a browser-safe, read-only public embed token for an existing tenant.
# Example:
#   make public-token ORG_SLUG=jlav ALLOWED_ORIGINS='https://jlav.io,https://www.jlav.io'
# Leave ALLOWED_ORIGINS empty to mint an unbound "share link" token.
public-token:
	@test -n "$(ORG_SLUG)" || (echo "ORG_SLUG=<slug> [ALLOWED_ORIGINS=...] [PUBLIC_TOKEN_NAME=embed] make public-token" && exit 1)
	ORG_SLUG=$(ORG_SLUG) \
		ALLOWED_ORIGINS="$(ALLOWED_ORIGINS)" \
		PUBLIC_TOKEN_NAME="$(PUBLIC_TOKEN_NAME)" \
		bash deploy/provision-public-token.sh

# One-shot variant that SSHes into the Lightsail box and mints the token
# there. Matches the ergonomics of prod-ssh / prod-logs.
# Example:
#   HOST=ubuntu@44.198.214.153 ORG_SLUG=jlav \
#     ALLOWED_ORIGINS='https://jlav.io,https://www.jlav.io' \
#     make prod-public-token
prod-public-token:
	@test -n "$(HOST)" || (echo "HOST=ubuntu@<ip> ORG_SLUG=... make prod-public-token" && exit 1)
	@test -n "$(ORG_SLUG)" || (echo "ORG_SLUG required" && exit 1)
	$(SSH) $(HOST) "cd /opt/webalytics && sudo \
		ORG_SLUG=$(ORG_SLUG) \
		ALLOWED_ORIGINS='$(ALLOWED_ORIGINS)' \
		PUBLIC_TOKEN_NAME='$(PUBLIC_TOKEN_NAME)' \
		bash deploy/provision-public-token.sh"

# Wipes only the event/analytics data out of ClickHouse, leaving the api,
# seed config, users/sites intact. Useful when dashboard counts have been
# inflated by Playwright runs or prior dev sessions. To nuke everything
# (including your seed token/site UUID) use `make down && make up-demo`.
reset-data:
	@echo "truncating all webalytics.* tables in clickhouse..."
	@$(COMPOSE) exec -T clickhouse clickhouse-client \
		--user=webalytics --password=$${CLICKHOUSE_PASSWORD:-changeme} \
		-q "TRUNCATE TABLE IF EXISTS webalytics.events; \
		    TRUNCATE TABLE IF EXISTS webalytics.sessions; \
		    TRUNCATE TABLE IF EXISTS webalytics.daily_traffic; \
		    TRUNCATE TABLE IF EXISTS webalytics.daily_referrers; \
		    TRUNCATE TABLE IF EXISTS webalytics.daily_utm; \
		    TRUNCATE TABLE IF EXISTS webalytics.daily_vitals;"
	@echo "done. Dashboard should read zeros until new events arrive."

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

# --- Terraform / deploy ----------------------------------------------------
# Lightsail box provisioning + remote redeploy. Requires AWS creds in env
# (or ~/.aws/credentials). One-time: `cd infra/terraform && cp
# terraform.tfvars.example terraform.tfvars && $EDITOR terraform.tfvars`.

TF_DIR ?= infra/terraform

tf-init:
	cd $(TF_DIR) && terraform init

tf-plan:
	cd $(TF_DIR) && terraform plan

tf-apply:
	cd $(TF_DIR) && terraform apply

tf-destroy:
	cd $(TF_DIR) && terraform destroy

tf-output:
	cd $(TF_DIR) && terraform output

# Out-of-band manual redeploy (CI does this automatically on green main).
# Pulls main + restarts the systemd unit on the Lightsail box.
# Uses $(SSH) so it picks up infra/terraform/keys/webalytics_ed25519
# automatically if present, or SSH_KEY=... if you set it.
deploy:
	@test -n "$(HOST)" || (echo "HOST=ubuntu@<ip> make deploy" && exit 1)
	$(SSH) $(HOST) 'set -e; cd /opt/webalytics && git fetch --all --prune && git reset --hard origin/main && sudo systemctl restart webalytics.service && sudo systemctl status --no-pager webalytics.service | head -n 20'

prod-logs:
	@test -n "$(HOST)" || (echo "HOST=ubuntu@<ip> make prod-logs" && exit 1)
	$(SSH) $(HOST) 'cd /opt/webalytics && sudo docker compose --env-file /opt/webalytics/.env.prod -f docker-compose.yml -f docker-compose.prod.yml --profile prod logs -f --tail=200'

prod-ssh:
	@test -n "$(HOST)" || (echo "HOST=ubuntu@<ip> make prod-ssh" && exit 1)
	$(SSH) $(HOST)

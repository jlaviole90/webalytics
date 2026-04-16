#!/usr/bin/env bash
# cloud-init / user_data for the webalytics Lightsail instance.
#
# Bootstraps: Docker, Compose v2, the project checkout, and a systemd
# unit that brings the stack up on every boot. Idempotent: re-running
# (e.g. via `sudo bash /var/lib/cloud/instance/user-data.txt`) is safe.

set -euxo pipefail

PROJECT="${project}"
REPO_URL="${git_repo_url}"
BRANCH="${git_branch}"
DOMAIN_VAR="${domain}"
APP_DIR="/opt/$PROJECT"
ENV_FILE="$APP_DIR/.env.prod"

# --- 1. Base packages --------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git gnupg lsb-release ufw apache2-utils

# --- 2. Docker engine + compose plugin ---------------------------------
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  usermod -aG docker ubuntu || true
fi

# --- 3. Firewall (belt-and-braces; Lightsail's own firewall is primary)
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# --- 4. Repo checkout --------------------------------------------------
mkdir -p "$APP_DIR"
chown ubuntu:ubuntu "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u ubuntu git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  sudo -u ubuntu git -C "$APP_DIR" fetch --all --prune
  sudo -u ubuntu git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u ubuntu git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi

# --- 5. Prod env file --------------------------------------------------
# Secrets are generated on first boot and never touched again. If you
# need to rotate, edit this file in place and `systemctl restart webalytics`.
if [ ! -f "$ENV_FILE" ]; then
  SESSION_SALT_BASE="$(openssl rand -hex 32)"
  CLICKHOUSE_PASSWORD="$(openssl rand -hex 24)"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Auto-generated on first boot. Do not commit. Rotations require
# a \`docker compose down\` + re-seed if the salt changes.
SESSION_SALT_BASE=$SESSION_SALT_BASE
CLICKHOUSE_PASSWORD=$CLICKHOUSE_PASSWORD
CLICKHOUSE_USER=webalytics
CLICKHOUSE_DATABASE=webalytics
DOMAIN=$DOMAIN_VAR
EOF
  chown ubuntu:ubuntu "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# --- 6. systemd unit: compose up on boot, down on shutdown -------------
cat > /etc/systemd/system/webalytics.service <<'UNIT'
[Unit]
Description=Webalytics (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=ubuntu
Group=docker
WorkingDirectory=/opt/webalytics
EnvironmentFile=/opt/webalytics/.env.prod
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml down
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable webalytics.service
systemctl start webalytics.service

# --- 7. First-boot seed -----------------------------------------------
# Wait for postgres to come up (compose health-gates migrate/api, but the
# seed script is a separate one-shot), then populate a default site so
# the dashboard isn't empty.
if [ ! -f "$APP_DIR/deploy/.seeded.env" ]; then
  for i in {1..60}; do
    if sudo -u ubuntu docker compose -f "$APP_DIR/docker-compose.yml" -f "$APP_DIR/docker-compose.prod.yml" ps postgres | grep -q "(healthy)"; then
      break
    fi
    sleep 5
  done
  sudo -u ubuntu env ENV_FILE="$ENV_FILE" bash -c \
    "cd $APP_DIR && set -a && source $ENV_FILE && set +a && bash deploy/seed.sh" || true
fi

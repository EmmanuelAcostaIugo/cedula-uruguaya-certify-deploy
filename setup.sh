#!/usr/bin/env bash
# Bootstrap script for a fresh Ubuntu 22.04 EC2 instance.
# Run as root (or with sudo) from the root of this repo, after creating .env from .env.example.
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env - copy .env.example to .env and fill in real values first." >&2
  exit 1
fi
set -a
source .env
set +a

for var in POSTGRES_PASSWORD DUCKDNS_DOMAIN DUCKDNS_TOKEN LETSENCRYPT_EMAIL; do
  if [ -z "${!var:-}" ]; then
    echo "Missing required .env value: $var" >&2
    exit 1
  fi
done

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "==> Updating DuckDNS record to this instance's public IP"
curl -fsS "https://www.duckdns.org/update?domains=$(echo "$DUCKDNS_DOMAIN" | cut -d. -f1)&token=$DUCKDNS_TOKEN&ip=" >/dev/null
( { crontab -l 2>/dev/null || true; } | grep -v duckdns.org || true; echo "*/5 * * * * curl -fsS \"https://www.duckdns.org/update?domains=$(echo "$DUCKDNS_DOMAIN" | cut -d. -f1)&token=$DUCKDNS_TOKEN&ip=\" >/dev/null 2>&1" ) | crontab -

echo "==> Creating a temporary self-signed cert so nginx can boot before the real one exists"
docker volume create cedula-letsencrypt >/dev/null
docker run --rm --entrypoint sh -v cedula-letsencrypt:/etc/letsencrypt alpine/openssl -c \
  "mkdir -p /etc/letsencrypt/live/$DUCKDNS_DOMAIN && \
   openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
     -keyout /etc/letsencrypt/live/$DUCKDNS_DOMAIN/privkey.pem \
     -out /etc/letsencrypt/live/$DUCKDNS_DOMAIN/fullchain.pem \
     -subj /CN=$DUCKDNS_DOMAIN"

echo "==> Starting database, certify and nginx (with the temporary cert)"
docker compose up -d database certify certify-nginx

echo "==> Waiting for nginx to answer on port 80"
for i in $(seq 1 30); do
  curl -fsS "http://$DUCKDNS_DOMAIN/.well-known/acme-challenge/" >/dev/null 2>&1 && break || sleep 2
done

echo "==> Requesting the real Let's Encrypt certificate"
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d "$DUCKDNS_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive

echo "==> Reloading nginx with the real certificate and starting the renewal loop"
docker compose restart certify-nginx
docker compose up -d certbot

echo "==> Done. Certify should be reachable at https://$DUCKDNS_DOMAIN/v1/certify/.well-known/did.json"
echo "    Next manual steps:"
echo "    1) Fetch the DID and publish it to your DID github pages repo (it's a NEW key on a fresh instance)."
echo "    2) POST config/cedula-uruguaya-credential-config.json to https://$DUCKDNS_DOMAIN/v1/certify/credential-configurations"

#!/usr/bin/env bash
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop or Docker Engine, then run this script again." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

configured_secret="$(grep '^AUTH_SECRET=' .env | cut -d= -f2- || true)"
if [ -z "$configured_secret" ] || [ "$configured_secret" = "replace-with-a-long-random-string" ]; then
  if command -v openssl >/dev/null 2>&1; then
    generated_secret="$(openssl rand -hex 32)"
  else
    generated_secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  if grep -q '^AUTH_SECRET=' .env; then
    awk -v secret="$generated_secret" 'BEGIN { updated = 0 } /^AUTH_SECRET=/ { print "AUTH_SECRET=" secret; updated = 1; next } { print } END { if (!updated) print "AUTH_SECRET=" secret }' .env > .env.tmp
    mv .env.tmp .env
  else
    printf '\nAUTH_SECRET=%s\n' "$generated_secret" >> .env
  fi
  echo "Generated a private AUTH_SECRET in .env." >&2
fi

chmod 600 .env
echo "Create the owner account in the browser, then add storage values to .env before using Notes publicly." >&2

docker compose up -d --build
echo "Notes is running at http://localhost:${NOTES_PORT:-3000}"

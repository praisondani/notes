#!/usr/bin/env bash
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop or Docker Engine, then run this script again." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set AUTH_PASSWORD and storage values before exposing Notes." >&2
fi

docker compose up -d --build
echo "Notes is running at http://localhost:${NOTES_PORT:-3000}"

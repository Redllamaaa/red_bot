#!/usr/bin/env bash
set -euo pipefail

main() {
  cd /root/red_bot
  git fetch origin main
  git reset --hard origin/main

  docker compose up -d --build
  docker image prune -f
}

main "$@"
exit
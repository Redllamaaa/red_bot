#!/usr/bin/env bash
set -euo pipefail

main() {
  # only one deploy at a time
  exec 9>/tmp/red_bot_deploy.lock
  flock 9

  cd /root/red_bot
  git fetch origin main
  git reset --hard origin/main

  # remove leftovers from an interrupted recreate
  docker ps -aq --filter "name=_red-bot" | xargs -r docker rm -f

  docker compose up -d --build
  docker image prune -f
}

main "$@"
exit
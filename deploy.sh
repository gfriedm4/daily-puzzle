#!/usr/bin/env bash
# Pull the latest main and rebuild the running container. Idempotent: if nothing
# changed, the build is a no-op and the container keeps running. Run by the
# GitHub Action on every push to main, or by hand on the box.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only
docker compose up -d --build
docker image prune -f
echo "wordshot: deploy complete"

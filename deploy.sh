#!/usr/bin/env bash
# Pull the latest main and rebuild the running container. Idempotent: if nothing
# changed, the build is a no-op and the container keeps running. Run by the
# GitHub Action on every push to main, or by hand on the box.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only
docker compose up -d --build

# The Caddyfile is a single-file bind mount, which latches onto the file's inode
# at container start. `git pull` replaces the file (new inode), so neither
# `caddy reload` nor `restart` sees the change: both read the stale inode the
# running container is still bound to. Force-recreating the container re-binds the
# mount to the current file. Costs a ~1s blip; the cert cache lives in the
# caddy-data volume so nothing is re-issued.
docker compose up -d --force-recreate caddy

docker image prune -f
echo "wordshot: deploy complete"

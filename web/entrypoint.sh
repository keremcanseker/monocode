#!/usr/bin/env bash
# Runs as the unprivileged image user; PID 1 is tini, which reaps orphaned provider processes.
set -euo pipefail
umask 077
host=/app/build/host/monocode-host.mjs
data="$HOME/.monocode-host-web" # web/server.ts reads $data/web-proxy.token by default

if [ ! -w "$HOME" ]; then
  echo "MonoCode web: $HOME is not writable by $(id -un) (uid $(id -u)); use a new volume or chown it to that uid" >&2
  exit 1
fi
mkdir -p "$data"
if [ ! -s "$data/web-proxy.token" ]; then
  node "$host" pair --data-dir "$data" --name "Web (container)" --json |
    node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).token' >"$data/web-proxy.token.tmp"
  mv "$data/web-proxy.token.tmp" "$data/web-proxy.token"
fi

# Providers inherit the host's environment; keep the launch key out of agent shells.
env -u MONOCODE_WEB_KEY node "$host" serve --data-dir "$data" --port 3774 &
host_pid=$!
node /app/web/serve.ts &
web_pid=$!
# Either service exiting or a stop signal ends both. Signal once: the host shuts down
# gracefully on its first SIGTERM and dies on a second (host/cli.ts:293).
trap : TERM INT
status=0
wait -n || status=$?
kill -TERM "$host_pid" "$web_pid" 2>/dev/null || true
wait || true
exit "$status"

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

# Hermes keeps its memory, jobs and keys in ~/.hermes. A new one starts on Claude through the
# Claude Code login, and gets the OpenCode Go key from `opencode auth login` when it has none.
mkdir -p "$HOME/.hermes"
if [ ! -e "$HOME/.hermes/config.yaml" ]; then
  { hermes config set model.provider copilot-acp && hermes config set model.default copilot-acp; } >/dev/null ||
    echo "MonoCode web: could not set Hermes' default model" >&2
fi
opencode_auth="$HOME/.local/share/opencode/auth.json"
if [ -s "$opencode_auth" ] && ! grep -qs '^OPENCODE_GO_API_KEY=' "$HOME/.hermes/.env"; then
  key=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))["opencode-go"]?.key ?? ""' "$opencode_auth" 2>/dev/null) || key=""
  [ -z "$key" ] || printf 'OPENCODE_GO_API_KEY=%s\n' "$key" >>"$HOME/.hermes/.env"
fi

# Providers inherit the host's environment; keep the launch key out of agent shells.
env -u MONOCODE_WEB_KEY node "$host" serve --data-dir "$data" --port 3774 &
host_pid=$!
node /app/web/serve.ts &
web_pid=$!
# Hermes' gateway runs its scheduled jobs. It restarts on its own instead of stopping the UI.
(
  trap 'kill -TERM "$gateway" 2>/dev/null || true; wait "$gateway" || true; exit 0' TERM
  while :; do
    env -u MONOCODE_WEB_KEY hermes gateway run &
    gateway=$!
    wait "$gateway" || true
    echo "MonoCode web: Hermes gateway stopped, restarting in 30s" >&2
    sleep 30 &
    wait $! || true
  done
) &
gateway_pid=$!
# The host or the web server exiting, or a stop signal, ends everything. Signal once: the host
# shuts down gracefully on its first SIGTERM and dies on a second (host/cli.ts:293).
trap : TERM INT
status=0
wait -n "$host_pid" "$web_pid" || status=$?
kill -TERM "$host_pid" "$web_pid" "$gateway_pid" 2>/dev/null || true
wait || true
exit "$status"

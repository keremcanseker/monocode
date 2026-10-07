# Web mode (experimental)

Runs the unmodified desktop UI in a normal browser tab. Every project is a
folder on a MonoCode host (see [remote-access.md](remote-access.md)); the
browser never runs agents itself.

```
browser ── same-origin POST /rpc ──▶ web server (127.0.0.1:1430)
                                       └─ adds the host device token ──▶ MonoCode host (127.0.0.1:3774) ──▶ claude / codex / hermes / opencode …
```

- `src/web-shim/` installs `@tauri-apps/api/mocks` before `src/main.tsx` loads
  and answers IPC calls: `remote_request` and `remote_machines` go to the host,
  dialogs and links use browser equivalents, a few boot-time desktop setters are
  no-ops, and everything else rejects like a failed command.
- `web/server.ts` is the Vite plugin for `web:dev` (it swaps the HTML entry)
  plus the `/rpc` gate, security headers and the small production server that
  `web/serve.ts` starts for `npm run web` and the container image.
- No existing source file changes; `vite.web.config.ts` extends `vite.config.ts`.

## Run locally

```sh
npm run host:build
mkdir -p -m 700 ~/.monocode-host-web
node build/host/monocode-host.mjs pair --data-dir ~/.monocode-host-web --name "Browser" --json
# save the printed "token" to ~/.monocode-host-web/web-proxy.token (chmod 600)
node build/host/monocode-host.mjs serve --data-dir ~/.monocode-host-web   # keep running

npm run web        # build + serve; or `npm run web:dev` while changing the shim
```

Open the `http://127.0.0.1:1430/#key=…` URL the server prints. The key moves
into this origin's storage and disappears from the address bar. Every server
start makes a new key, so open the new URL after a restart. Then use
**Projects → + → Open folder on a machine…**.

Environment overrides: `MONOCODE_HOST_URL` (default `http://127.0.0.1:3774`),
`MONOCODE_HOST_TOKEN_FILE` (default `~/.monocode-host-web/web-proxy.token`),
`MONOCODE_WEB_PORT` (default `1430`), `MONOCODE_WEB_KEY` (a fixed launch key
instead of a new one per start; 32+ characters of `A-Z a-z 0-9 _ -`).

## Run behind a TLS reverse proxy (container)

`web/Dockerfile` builds one image on top of the official Hermes Agent image
(`nousresearch/hermes-agent`, pinned) and adds pinned Claude Code and OpenCode.
`tini` is PID 1, so the Hermes entrypoint prepares `/opt/data` as root and then
runs `web/entrypoint.sh` as the unprivileged `hermes` user with
`HOME=/opt/data`. The entrypoint pairs the web server with the host on first
boot, then runs both; either one exiting stops the container.

```sh
docker build -f web/Dockerfile -t monocode-web .
docker run -d -p 127.0.0.1:1430:1430 \
  -e MONOCODE_WEB_ORIGIN=https://monocode.example.com \
  -e MONOCODE_WEB_KEY="$(openssl rand -hex 32)" \
  -v monocode-data:/opt/data monocode-web
```

- `MONOCODE_WEB_ORIGIN` is the exact public origin the browser uses. The gate
  accepts `/rpc` only from it; `X-Forwarded-*` headers are ignored. It must be
  `https`.
- Binding anything but `127.0.0.1` (`MONOCODE_WEB_BIND=0.0.0.0`, set by the
  image) requires `MONOCODE_WEB_ORIGIN` and `MONOCODE_WEB_KEY`. The key then
  survives restarts and redeploys and is not printed; open
  `https://<origin>/#key=<MONOCODE_WEB_KEY>` once per browser. Rotate it by
  changing the variable and restarting.
- The single volume `/opt/data` holds the host data (`.monocode-host-web`),
  provider logins and keys (`.claude`, `.claude.json`, `.local/share/opencode`,
  Hermes' `config.yaml` and `.env`) and projects (`workspace/`). Delete
  `.monocode-host-web/web-proxy.token` to re-pair.
- Run one-time logins as the image user so files stay owned by it:
  `docker exec -it -u hermes -e HOME=/opt/data <container> claude auth login`.
  Never put `ANTHROPIC_API_KEY` in the container environment: the host passes
  its environment to providers, and an API key wins over the subscription.
- Run only one container per volume (disable rolling updates): a second host
  on the same data directory refuses to start.
- Everyone who has the key and can reach the proxy controls the container's
  user. Restrict the proxy to trusted networks as well.

## Security model

The device token gives full control of the host's OS user, so it never reaches
the page. The `/rpc` gate forwards a request only when it is a same-origin POST
from `http://127.0.0.1:<port>` (or `MONOCODE_WEB_ORIGIN`) carrying the launch
key header, and it builds a fresh request with just the token and content type.
`devices.revokeSelf` is refused so the page cannot revoke the server's own
credential. By default the server binds to `127.0.0.1` only (not `localhost`,
which can resolve to `::1` and leave the IPv4 port free for another process). A `#key=` from a link replaces the stored
key only after the server accepts it.

`npm run web` serves the production build with a strict CSP (scripts from self
plus hashed inline scripts, `connect-src 'self'`, no frames). `web:dev` allows
inline scripts for React refresh and exposes Vite's dev endpoints, so use it only
while developing.

Anything that can run script on the page origin (an extension with access to
all sites, for example) inherits host access. Use a browser profile without
extensions for this origin.

## Limits

Local-only features (terminal, local projects, automations, notes, skills,
updater) are unavailable, as they are for host projects on the desktop. The host
does not notify when a turn finishes, only for approvals and questions. Browser
shortcuts such as ⌘T and ⌘W stay with the browser.

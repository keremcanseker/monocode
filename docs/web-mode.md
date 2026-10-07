# Web mode (experimental)

Runs the unmodified desktop UI in a normal browser tab. Every project is a
folder on a MonoCode host (see [remote-access.md](remote-access.md)); the
browser never runs agents itself.

```
browser ── same-origin POST /rpc ──▶ web server (Vite, 127.0.0.1:1430)
                                       └─ adds the host device token ──▶ MonoCode host (127.0.0.1:3774) ──▶ claude / codex / hermes / opencode …
```

- `src/web-shim/` installs `@tauri-apps/api/mocks` before `src/main.tsx` loads
  and answers IPC calls: `remote_request` and `remote_machines` go to the host,
  dialogs and links use browser equivalents, a few boot-time desktop setters are
  no-ops, and everything else rejects like a failed command.
- `web/server.ts` is the Vite plugin: it swaps the HTML entry, serves the
  `/rpc` gate and sets the security headers.
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
`MONOCODE_HOST_TOKEN_FILE` (default `~/.monocode-host-web/web-proxy.token`).

## Security model

The device token gives full control of the host's OS user, so it never reaches
the page. The `/rpc` gate forwards a request only when it is a same-origin POST
from `http://127.0.0.1:<port>` carrying the launch key header, and it builds a
fresh request with just the token and content type. `devices.revokeSelf` is
refused so the page cannot revoke the server's own credential. The server binds
to `127.0.0.1` only (not `localhost`, which can resolve to `::1` and leave the
IPv4 port free for another process). A `#key=` from a link replaces the stored
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

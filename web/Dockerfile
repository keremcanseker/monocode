# MonoCode web mode in one container: UI + /rpc gate on :1430, headless host on 127.0.0.1:3774,
# providers Hermes (base image), Claude Code and OpenCode. Build from the repo root: docker build -f web/Dockerfile .
FROM node:24.21.0-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run host:build && npx vite build --config vite.web.config.ts

# ponytail: Hermes ships no maintained package (PyPI is stale), so its official image is the base.
FROM nousresearch/hermes-agent:v2026.9.24@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7
USER root
ARG CLAUDE_CODE_VERSION=2.1.293
ARG OPENCODE_VERSION=1.18.35
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* && tini-static --version
# Pinned CLIs outside HOME; npm postinstall picks the right native build for this CPU.
WORKDIR /tmp
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} opencode-ai@${OPENCODE_VERSION} \
 && claude --version | grep -q "^${CLAUDE_CODE_VERSION}" \
 && opencode --version | grep -qx "${OPENCODE_VERSION}"
# The user-writable ~/.local/bin goes last so nothing in the volume can shadow the pinned CLIs.
ENV PATH=/opt/hermes/bin:/opt/hermes/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/data/.local/bin \
    DISABLE_AUTOUPDATER=1 OPENCODE_DISABLE_AUTOUPDATE=1 \
    MONOCODE_WEB_BIND=0.0.0.0 MONOCODE_WEB_PORT=1430
WORKDIR /app
COPY --from=build /src/build/host/monocode-host.mjs /src/build/host/provider-guard.mjs build/host/
COPY --from=build /src/build/web build/web
COPY --from=build /src/web/server.ts /src/web/serve.ts web/
COPY --chmod=0755 web/entrypoint.sh /usr/local/bin/monocode-web
RUN echo '{"type":"module"}' > package.json
EXPOSE 1430
# tini as PID 1 sends Hermes' dispatcher down its non-PID-1 path: bootstrap /opt/data as root,
# then run CMD as uid 10000 (hermes) with HOME=/opt/data. No s6 services start.
ENTRYPOINT ["/usr/bin/tini-static", "--", "/opt/hermes/docker/entrypoint-dispatch.sh"]
CMD ["monocode-web"]

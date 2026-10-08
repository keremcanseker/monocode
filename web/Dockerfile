# MonoCode web mode in one container: UI + /rpc gate on :1430, headless host on 127.0.0.1:3774,
# providers Claude Code and OpenCode. Build from the repo root: docker build -f web/Dockerfile .
FROM node:24.21.0-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run host:build && npx vite build --config vite.web.config.ts

FROM node:24.21.0-bookworm-slim
# tini reaps orphaned provider processes; the rest is what general-purpose agents expect to find.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates curl git openssh-client ripgrep jq less procps unzip python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
ARG CLAUDE_CODE_VERSION=2.1.293
ARG OPENCODE_VERSION=1.18.35
# Pinned CLIs in root-owned /usr/local, outside the volume. Their postinstall swaps a placeholder
# for the native build that fits this CPU (OpenCode picks its non-AVX2 build when needed).
RUN npm install -g --allow-scripts=@anthropic-ai/claude-code,opencode-ai \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} opencode-ai@${OPENCODE_VERSION} \
 && claude --version | grep -q "^${CLAUDE_CODE_VERSION}" \
 && opencode --version | grep -qx "${OPENCODE_VERSION}" \
 && npm cache clean --force
# The volume is the node user's HOME: host data, provider logins, projects. Created here so a new
# named volume starts owned by node. Claude Code refuses full access as root.
RUN usermod -d /opt/data node && mkdir -m 700 /opt/data && chown node:node /opt/data
# The user-writable ~/.local/bin goes last so nothing in the volume can shadow the pinned CLIs.
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/data/.local/bin \
    DISABLE_AUTOUPDATER=1 OPENCODE_DISABLE_AUTOUPDATE=1 \
    MONOCODE_WEB_BIND=0.0.0.0 MONOCODE_WEB_PORT=1430
WORKDIR /app
COPY --from=build /src/build/host/monocode-host.mjs /src/build/host/provider-guard.mjs build/host/
COPY --from=build /src/build/web build/web
COPY --from=build /src/web/server.ts /src/web/serve.ts web/
COPY --chmod=0755 web/entrypoint.sh /usr/local/bin/monocode-web
RUN echo '{"type":"module"}' > package.json
USER node
WORKDIR /opt/data
EXPOSE 1430
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS -o /dev/null http://127.0.0.1:1430/ || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["monocode-web"]

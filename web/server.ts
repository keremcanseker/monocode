import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

const MAX_BODY = 16 * 1024 * 1024;
const KEY_HEADER = "x-monocode-web-key";
const ENTRY = 'src="/src/main.tsx"';
const SHIM_ENTRY = 'src="/src/web-shim/main.ts"';
// The desktop paints through native vibrancy; a browser has none, so keep the opaque base.
const GLASS_OVERRIDE =
  "<style>html.has-native-glass,html.has-native-glass body,html.has-native-glass #root{background:var(--color-background-base)!important}</style>";
// One exact address: "localhost" can resolve to ::1 and leave 127.0.0.1:<port> free for another process.
const BIND = "127.0.0.1";

type Next = (error?: unknown) => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

export type GateOptions = {
  hostUrl: string;
  token: string | undefined;
  key: string;
  allowedOrigins: string[];
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};
const refuse = (res: ServerResponse, status: number, message: string) =>
  send(res, status, { proxyError: "refused", message });

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.removeAllListeners("data");
        done(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

const rpcMethod = (body: Buffer) => {
  try {
    return (JSON.parse(body.toString("utf8")) as { method?: unknown }).method;
  } catch {
    return undefined;
  }
};

/** Same-origin /rpc endpoint that adds the host device token server-side. */
export function createRpcGate(options: GateOptions): Middleware {
  const doFetch = options.fetch ?? fetch;
  return (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/rpc")) return next();
    if (url !== "/rpc") return refuse(res, 404, "Unknown route");
    if (req.method !== "POST") return refuse(res, 405, "POST only");
    if (!options.allowedOrigins.includes(String(req.headers.origin)))
      return refuse(res, 403, "Origin not allowed");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin")
      return refuse(res, 403, "Cross-site request");
    if (!sameSecret(String(req.headers[KEY_HEADER] ?? ""), options.key))
      return refuse(res, 401, "Open the launch URL printed by the web server");
    if (!options.token)
      return refuse(res, 503, "No host device token configured for the web server");
    void (async () => {
      const body = await readBody(req);
      if (!body) return refuse(res, 413, "Request is too large");
      // The token belongs to this server, not the page; never let the page revoke it.
      if (rpcMethod(body) === "devices.revokeSelf")
        return refuse(res, 403, "The web server's own device credential cannot be revoked from the page");
      let response: Response;
      try {
        response = await doFetch(`${options.hostUrl}/rpc`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.token}`,
            "Content-Type": "application/json",
          },
          body: new Uint8Array(body),
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        return send(res, code === "ECONNREFUSED" ? 502 : 504, {
          proxyError: code === "ECONNREFUSED" ? "unreachable" : "incomplete",
        });
      }
      const text = await response.text().catch(() => undefined);
      if (text === undefined) return send(res, 502, { proxyError: "incomplete" });
      res.statusCode = response.status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(text);
    })().catch(() => {
      if (!res.headersSent) send(res, 502, { proxyError: "incomplete" });
    });
  };
}

/** Hashes of inline scripts so a strict script-src still runs them. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
}

export function contentSecurityPolicy(scriptSources: string[], dev: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' ${dev ? "'unsafe-inline'" : scriptSources.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://uploads.linear.app https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: " : ""}`.trimEnd(),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const securityHeaders =
  (csp: string): Middleware =>
  (_req, res, next) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  };

function assertLoopback(host: string | boolean | undefined, where: string) {
  if (host !== BIND) throw new Error(`MonoCode web must bind to ${BIND} only (${where}.host=${String(host)})`);
}

export function parseHostUrl(value: string, name = "MONOCODE_HOST_URL") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${name} must be http(s): ${value}`);
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error(`${name} must be just scheme://host:port: ${value}`);
  return url.origin;
}

export type WebSettings = { bind: string; port: number; origin: string; key: string; url: string };

/** Loopback with a per-start key by default; anything wider needs an https public origin and a fixed key. */
export function webSettings(env: Record<string, string | undefined> = process.env): WebSettings {
  const port = Number(env.MONOCODE_WEB_PORT ?? 1430);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`MONOCODE_WEB_PORT is not a port: ${env.MONOCODE_WEB_PORT}`);
  const bind = env.MONOCODE_WEB_BIND ?? BIND;
  const fixed = env.MONOCODE_WEB_KEY;
  // URLSearchParams turns "+" into a space, so base64 keys would never match.
  if (fixed !== undefined && !/^[A-Za-z0-9_-]{32,}$/.test(fixed))
    throw new Error("MONOCODE_WEB_KEY must be 32+ characters of A-Z a-z 0-9 _ -");
  if (!env.MONOCODE_WEB_ORIGIN) {
    if (bind !== BIND) throw new Error(`MONOCODE_WEB_BIND=${bind} needs MONOCODE_WEB_ORIGIN and MONOCODE_WEB_KEY`);
    const key = fixed ?? randomBytes(32).toString("base64url");
    const origin = `http://${BIND}:${port}`;
    return { bind, port, origin, key, url: `${origin}/#key=${key}` };
  }
  const origin = parseHostUrl(env.MONOCODE_WEB_ORIGIN, "MONOCODE_WEB_ORIGIN");
  if (!origin.startsWith("https://")) throw new Error(`MONOCODE_WEB_ORIGIN must be https: ${origin}`);
  if (!fixed) throw new Error("MONOCODE_WEB_ORIGIN needs MONOCODE_WEB_KEY");
  // The fixed key stays out of logs; whoever set it opens the URL with it.
  return { bind, port, origin, key: fixed, url: `${origin}/#key=<MONOCODE_WEB_KEY>` };
}

export function hostSettings() {
  const tokenFile =
    process.env.MONOCODE_HOST_TOKEN_FILE ?? join(homedir(), ".monocode-host-web", "web-proxy.token");
  const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : undefined;
  const valid = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  return {
    hostUrl: parseHostUrl(process.env.MONOCODE_HOST_URL ?? "http://127.0.0.1:3774"),
    token: valid,
    tokenFile,
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** Production server: the built UI with a strict CSP plus the /rpc gate, nothing else. */
export function createWebServer(web: WebSettings, root: string, host = hostSettings()) {
  root = resolve(root);
  const csp = contentSecurityPolicy(inlineScriptHashes(readFileSync(join(root, "index.html"), "utf8")), false);
  const headers = securityHeaders(csp);
  const gate = createRpcGate({ ...host, key: web.key, allowedOrigins: [web.origin] });
  return createServer((req, res) =>
    headers(req, res, () =>
      gate(req, res, () => {
        if (req.method !== "GET" && req.method !== "HEAD") return refuse(res, 405, "GET only");
        let file: string;
        try {
          file = resolve(root, `.${decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)}`);
        } catch {
          return refuse(res, 400, "Bad path");
        }
        if (file === root) file = join(root, "index.html");
        const type = TYPES[extname(file)];
        if (!type || !file.startsWith(root + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile())
          return refuse(res, 404, "Not found");
        res.setHeader("Content-Type", type);
        // Vite content-hashes everything under assets/, so a changed file gets a new name.
        if (file.startsWith(join(root, "assets") + sep)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        if (req.method === "HEAD") return res.end();
        createReadStream(file).on("error", () => res.destroy()).pipe(res);
      }),
    ),
  );
}

/** Serves the unmodified desktop UI in a browser, backed by a MonoCode host. */
export function monocodeWeb(): Plugin {
  let config: ResolvedConfig;
  const host = hostSettings();
  // Per process, so a key read out of browser storage stops working at the next start.
  const key = randomBytes(32).toString("base64url");
  const gate = (port: number) =>
    createRpcGate({
      ...host,
      key,
      allowedOrigins: [`http://${BIND}:${port}`],
    });
  const announce = (port: number) => {
    if (!host.token)
      config.logger.warn(`MonoCode web: no valid host token at ${host.tokenFile}; /rpc is disabled`);
    config.logger.info(`MonoCode web: open http://${BIND}:${port}/#key=${key}`);
  };
  return {
    name: "monocode-web",
    configResolved(resolved) {
      config = resolved;
      assertLoopback(resolved.server.host, "server");
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (basename(ctx.filename) !== "index.html") return html;
        if (!html.includes(ENTRY)) throw new Error(`index.html no longer loads ${ENTRY}`);
        return html.replace(ENTRY, SHIM_ENTRY).replace("</head>", `${GLASS_OVERRIDE}</head>`);
      },
    },
    configureServer(server) {
      const port = config.server.port ?? 1430;
      server.middlewares.use(securityHeaders(contentSecurityPolicy([], true)));
      server.middlewares.use(gate(port));
      server.httpServer?.once("listening", () => announce(port));
    },
  };
}

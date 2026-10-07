import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  createRpcGate,
  createWebServer,
  inlineScriptHashes,
  monocodeWeb,
  parseHostUrl,
  webSettings,
} from "../../web/server";

const TOKEN = "a".repeat(43);
const KEY = "launch-key";
const ORIGIN = "http://127.0.0.1:1430";

type Seen = { headers: IncomingHttpHeaders; body: string };
let host: Server;
let hostUrl: string;
let seen: Seen[] = [];
const replyOk = (res: import("node:http").ServerResponse) => res.end(JSON.stringify({ result: "ok" }));
let hostReply = replyOk;

const listen = (server: Server) =>
  new Promise<string>((done) =>
    server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
const close = (server: Server) => new Promise((done) => server.close(done));

beforeAll(async () => {
  host = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body });
      hostReply(res);
    });
  });
  hostUrl = await listen(host);
});
afterAll(() => close(host));
afterEach(() => {
  seen = [];
  hostReply = replyOk;
});

async function gateServer(overrides: Partial<Parameters<typeof createRpcGate>[0]> = {}) {
  const gate = createRpcGate({ hostUrl, token: TOKEN, key: KEY, allowedOrigins: [ORIGIN], ...overrides });
  const server = createServer((req, res) =>
    gate(req, res, () => {
      res.statusCode = 299;
      res.end("next");
    }),
  );
  return { server, url: await listen(server) };
}

function call(
  url: string,
  { path = "/rpc", method = "POST", headers = {}, body = '{"method":"sessions.list"}' }: {
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
) {
  return new Promise<{ status: number; body: string }>((done, fail) => {
    const req = request(`${url}${path}`, { method, headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => done({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", fail);
    req.end(body);
  });
}
const allowed = { origin: ORIGIN, "x-monocode-web-key": KEY, "sec-fetch-site": "same-origin" };

describe("createRpcGate", () => {
  it("forwards an allowed request with only the server-side token attached", async () => {
    const { server, url } = await gateServer();
    const res = await call(url, { headers: { ...allowed, cookie: "a=b", referer: ORIGIN } });
    expect(res).toEqual({ status: 200, body: '{"result":"ok"}' });
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe('{"method":"sessions.list"}');
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const header of ["origin", "cookie", "referer", "x-monocode-web-key", "sec-fetch-site"])
      expect(seen[0].headers[header]).toBeUndefined();
    await close(server);
  });

  it("relays host errors untouched so the UI sees the host's verdict", async () => {
    hostReply = (res) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Unsupported host method" }));
    };
    const { server, url } = await gateServer();
    expect(await call(url, { headers: allowed })).toEqual({ status: 400, body: '{"error":"Unsupported host method"}' });
    await close(server);
  });

  it.each([
    ["a foreign origin", { ...allowed, origin: "https://evil.example" }, 403],
    ["no origin", { "x-monocode-web-key": KEY }, 403],
    ["a cross-site fetch", { ...allowed, "sec-fetch-site": "same-site" }, 403],
    ["a missing launch key", { origin: ORIGIN }, 401],
    ["a wrong launch key", { ...allowed, "x-monocode-web-key": "guess" }, 401],
  ])("refuses %s without reaching the host", async (_, headers, status) => {
    const { server, url } = await gateServer();
    const res = await call(url, { headers });
    expect(res.status).toBe(status);
    expect(JSON.parse(res.body).proxyError).toBe("refused");
    expect(seen).toHaveLength(0);
    await close(server);
  });

  it("only owns the exact /rpc route", async () => {
    const { server, url } = await gateServer();
    expect((await call(url, { path: "/index.html", method: "GET", body: "" })).status).toBe(299);
    expect((await call(url, { path: "/rpc?x=1", headers: allowed })).status).toBe(404);
    expect((await call(url, { method: "GET", headers: allowed, body: "" })).status).toBe(405);
    expect(seen).toHaveLength(0);
    await close(server);
  });

  it("never lets the page revoke the server's own device credential", async () => {
    const { server, url } = await gateServer();
    const res = await call(url, { headers: allowed, body: '{"version":1,"method":"devices.revokeSelf","params":{}}' });
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
    await close(server);
  });

  it("refuses oversized bodies", async () => {
    const { server, url } = await gateServer();
    const res = await call(url, { headers: allowed, body: "x".repeat(16 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(seen).toHaveLength(0);
    await close(server);
  });

  it("reports a missing token instead of forwarding unauthenticated", async () => {
    const { server, url } = await gateServer({ token: undefined });
    expect((await call(url, { headers: allowed })).status).toBe(503);
    expect(seen).toHaveLength(0);
    await close(server);
  });

  it("marks a stopped host as unreachable", async () => {
    const stopped = createServer();
    const stoppedUrl = await listen(stopped);
    await close(stopped);
    const { server, url } = await gateServer({ hostUrl: stoppedUrl });
    const res = await call(url, { headers: allowed });
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ proxyError: "unreachable" });
    await close(server);
  });

  it("marks a hung host as incomplete, never as a rejection", async () => {
    hostReply = () => {};
    const { server, url } = await gateServer({ timeoutMs: 150 });
    const res = await call(url, { headers: allowed });
    expect(res.status).toBe(504);
    expect(JSON.parse(res.body)).toEqual({ proxyError: "incomplete" });
    await close(server);
  });
});

describe("content security policy", () => {
  it("hashes inline scripts and skips external ones", () => {
    const hashes = inlineScriptHashes('<script>let a=1</script><script type="module" src="/x.js"></script>');
    expect(hashes).toEqual(["'sha256-+Q3dsIT3kYyYXlBldxY4Baal1kEoF6cDrlPvZn4iLYs='"]);
  });

  it("keeps production scripts to self plus hashes and blocks framing", () => {
    const policy = contentSecurityPolicy(["'sha256-x'"], false);
    expect(policy).toContain("script-src 'self' 'sha256-x'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});

describe("monocodeWeb plugin", () => {
  const plugin = monocodeWeb();
  const transform = (html: string, filename: string) =>
    (plugin.transformIndexHtml as { handler: (html: string, ctx: { filename: string }) => string }).handler(html, {
      filename,
    });

  it("boots the browser shim instead of the desktop entry", () => {
    const html = transform('<head></head><script type="module" src="/src/main.tsx"></script>', "/repo/index.html");
    expect(html).toContain('src="/src/web-shim/main.ts"');
    expect(html).not.toContain('src="/src/main.tsx"');
    expect(html).toContain("html.has-native-glass");
  });

  it("leaves other pages alone and fails loudly if the desktop entry moves", () => {
    expect(transform("<x/>", "/repo/quick-composer.html")).toBe("<x/>");
    expect(() => transform("<head></head>", "/repo/index.html")).toThrow(/no longer loads/);
  });

  it.each(["0.0.0.0", true, "localhost", "::1", undefined])("refuses to bind anywhere but 127.0.0.1 (%s)", (host) => {
    const resolved = { server: { host }, preview: { host: "127.0.0.1" } };
    expect(() => (plugin.configResolved as (c: unknown) => void)(resolved)).toThrow(/127\.0\.0\.1/);
  });

  it("accepts the default 127.0.0.1 binding", () => {
    const resolved = { server: { host: "127.0.0.1" }, preview: { host: "127.0.0.1" } };
    expect(() => (plugin.configResolved as (c: unknown) => void)(resolved)).not.toThrow();
  });
});

describe("parseHostUrl", () => {
  it("normalizes a host URL to its origin", () => {
    expect(parseHostUrl("http://127.0.0.1:3774")).toBe("http://127.0.0.1:3774");
    expect(parseHostUrl("http://127.0.0.1:3774/")).toBe("http://127.0.0.1:3774");
  });

  it.each(["127.0.0.1:3774", "ftp://host", "http://127.0.0.1:3774/rpc", "http://h/?x=1", "nope"])("rejects %s", (value) => {
    expect(() => parseHostUrl(value)).toThrow(/MONOCODE_HOST_URL/);
  });
});

describe("webSettings", () => {
  const KEY64 = "k".repeat(64);
  const PUBLIC = "https://monocode.istfin.com";

  it("defaults to 127.0.0.1 with a new key per start, printed in the URL", () => {
    const a = webSettings({});
    expect(a).toMatchObject({ bind: "127.0.0.1", port: 1430, origin: ORIGIN });
    expect(a.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(webSettings({}).key);
    expect(a.url).toBe(`${ORIGIN}/#key=${a.key}`);
  });

  it("serves a public https origin with the fixed key and keeps the key out of the printed URL", () => {
    const env = { MONOCODE_WEB_BIND: "0.0.0.0", MONOCODE_WEB_ORIGIN: `${PUBLIC}/`, MONOCODE_WEB_KEY: KEY64 };
    expect(webSettings(env)).toEqual({
      bind: "0.0.0.0",
      port: 1430,
      origin: PUBLIC,
      key: KEY64,
      url: `${PUBLIC}/#key=<MONOCODE_WEB_KEY>`,
    });
  });

  it.each([
    ["a wide bind without a public origin", { MONOCODE_WEB_BIND: "0.0.0.0" }, /needs MONOCODE_WEB_ORIGIN/],
    ["a plain http public origin", { MONOCODE_WEB_ORIGIN: "http://monocode.istfin.com", MONOCODE_WEB_KEY: KEY64 }, /must be https/],
    ["a public origin with a path", { MONOCODE_WEB_ORIGIN: `${PUBLIC}/app`, MONOCODE_WEB_KEY: KEY64 }, /MONOCODE_WEB_ORIGIN/],
    ["a public origin without a fixed key", { MONOCODE_WEB_ORIGIN: PUBLIC }, /needs MONOCODE_WEB_KEY/],
    ["a short key", { MONOCODE_WEB_KEY: "short" }, /32\+/],
    ["a base64 key that URLSearchParams would mangle", { MONOCODE_WEB_KEY: "a+/=".repeat(10) }, /32\+/],
    ["an invalid port", { MONOCODE_WEB_PORT: "70000" }, /not a port/],
  ])("refuses %s", (_, env, message) => {
    expect(() => webSettings(env)).toThrow(message);
  });
});

describe("createWebServer", () => {
  const PUBLIC = "https://monocode.istfin.com";
  const KEY64 = "k".repeat(64);
  const root = mkdtempSync(join(tmpdir(), "monocode-web-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<script>boot()</script><script type="module" src="/assets/app.js"></script>');
  writeFileSync(join(root, "assets", "app.js"), "export {}");
  writeFileSync(join(root, "assets", "notes.md"), "not served");
  const proxied = { host: "monocode.istfin.com", "x-forwarded-proto": "https", "x-forwarded-for": "100.64.0.9" };

  async function webServer() {
    const web = webSettings({ MONOCODE_WEB_BIND: "0.0.0.0", MONOCODE_WEB_ORIGIN: PUBLIC, MONOCODE_WEB_KEY: KEY64 });
    const server = createWebServer(web, root, { hostUrl, token: TOKEN, tokenFile: "" });
    return { server, url: await listen(server) };
  }

  it("serves the UI and its assets to a proxied public Host", async () => {
    const { server, url } = await webServer();
    const page = await call(url, { path: "/", method: "GET", headers: proxied, body: "" });
    expect(page.status).toBe(200);
    const asset = await call(url, { path: "/assets/app.js", method: "GET", headers: proxied, body: "" });
    expect(asset).toEqual({ status: 200, body: "export {}" });
    await close(server);
  });

  it.each(["/../package.json", "/%2e%2e/package.json", "/assets/..%2F..%2Fpackage.json", "/assets/notes.md", "/missing.js", "/%E0%A4%A"])(
    "does not serve %s",
    async (path) => {
      const { server, url } = await webServer();
      expect([400, 404]).toContain((await call(url, { path, method: "GET", headers: proxied, body: "" })).status);
      await close(server);
    },
  );

  it("refuses writes outside /rpc", async () => {
    const { server, url } = await webServer();
    expect((await call(url, { path: "/", headers: proxied })).status).toBe(405);
    await close(server);
  });

  it("forwards /rpc only from the public origin, and never forwards proxy headers", async () => {
    const { server, url } = await webServer();
    const ok = { ...proxied, origin: PUBLIC, "sec-fetch-site": "same-origin", "x-monocode-web-key": KEY64 };
    expect((await call(url, { headers: ok })).status).toBe(200);
    expect(seen[0].headers["x-forwarded-for"]).toBeUndefined();
    expect(seen[0].headers["x-forwarded-proto"]).toBeUndefined();
    expect((await call(url, { headers: { ...ok, origin: ORIGIN } })).status).toBe(403);
    expect(seen).toHaveLength(1);
    await close(server);
  });
});

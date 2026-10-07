import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  createRpcGate,
  inlineScriptHashes,
  monocodeWeb,
  parseHostUrl,
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

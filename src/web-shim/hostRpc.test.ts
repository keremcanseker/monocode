// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshRemoteMachines } from "../features/connections/model/connections";
import {
  KEY_HEADER,
  WEB_MACHINE_ID,
  adoptLaunchKey,
  forgetWebMachine,
  resetForTests,
  webMachines,
  webRemoteRequest,
} from "./hostRpc";

const describeResult = { protocolVersion: 1, environmentId: "env-1", name: "mac", providers: ["claude"], capabilities: [] };
const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const cacheHost = (environmentId = "env-1") => {
  localStorage.setItem("monocode.web.machine.v1", JSON.stringify({ environmentId, name: "mac" }));
  resetForTests();
};

let fetchMock: ReturnType<typeof vi.fn>;
const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => {
  localStorage.clear();
  resetForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("adoptLaunchKey", () => {
  const at = (hash: string) => ({ hash, pathname: "/", search: "?x=1" }) as Location;
  const history = () => ({ state: null, replaceState: vi.fn() }) as unknown as History & { replaceState: ReturnType<typeof vi.fn> };

  it("stores a key the server accepts and strips it from the address bar", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { result: describeResult }));
    const h = history();
    await adoptLaunchKey(at("#key=abc"), h);
    expect(localStorage.getItem("monocode.web.key.v1")).toBe("abc");
    expect(h.replaceState).toHaveBeenCalledWith(null, "", "/?x=1");
    expect(fetchMock.mock.calls[0][1].headers[KEY_HEADER]).toBe("abc");
  });

  it("keeps the stored key when another site navigates here with a made-up one", async () => {
    localStorage.setItem("monocode.web.key.v1", "good");
    fetchMock.mockResolvedValueOnce(reply(401, { proxyError: "refused", message: "Open the launch URL" }));
    const h = history();
    await adoptLaunchKey(at("#key=evil"), h);
    expect(localStorage.getItem("monocode.web.key.v1")).toBe("good");
    expect(h.replaceState).toHaveBeenCalled();
  });

  it("accepts a valid key even while the host itself is down", async () => {
    fetchMock.mockResolvedValueOnce(reply(502, { proxyError: "unreachable" }));
    await adoptLaunchKey(at("#key=new"), history());
    expect(localStorage.getItem("monocode.web.key.v1")).toBe("new");
  });

  it("does nothing without a fragment key", async () => {
    localStorage.setItem("monocode.web.key.v1", "old");
    const h = history();
    await adoptLaunchKey(at(""), h);
    expect(localStorage.getItem("monocode.web.key.v1")).toBe("old");
    expect(h.replaceState).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("webRemoteRequest", () => {
  it("learns the host identity, then sends the versioned envelope with the launch key", async () => {
    localStorage.setItem("monocode.web.key.v1", "k");
    fetchMock
      .mockResolvedValueOnce(reply(200, { result: describeResult }))
      .mockResolvedValueOnce(reply(200, { result: { sessions: [] } }));
    await expect(webRemoteRequest(WEB_MACHINE_ID, "sessions.list", { project: "p" })).resolves.toEqual({ sessions: [] });
    expect(sent(0)).toMatchObject({ version: 1, environmentId: null, method: "environment.describe" });
    expect(sent(0).params.supportedProviders).toContain("hermes");
    expect(sent(1)).toEqual({ version: 1, environmentId: "env-1", method: "sessions.list", params: { project: "p" } });
    const init = fetchMock.mock.calls[1][1];
    expect(fetchMock.mock.calls[1][0]).toBe("/rpc");
    expect(init.headers[KEY_HEADER]).toBe("k");
    expect(init.credentials).toBe("same-origin");
  });

  it("rejects machines other than the web host", async () => {
    await expect(webRemoteRequest("other", "sessions.list", {})).rejects.toBe("Machine is no longer connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["host rejection", reply(400, { error: "Unsupported host method" }), "Host rejected request: Unsupported host method"],
    ["unreachable host", reply(502, { proxyError: "unreachable" }), "Machine is unreachable. Check the host and SSH tunnel, then reconnect."],
    ["incomplete request", reply(504, { proxyError: "incomplete" }), "The host request did not complete. Retry to confirm its result."],
    ["proxy refusal", reply(401, { proxyError: "refused", message: "Open the launch URL" }), "Web proxy refused the request: Open the launch URL"],
    ["non-200 without error", reply(500, { result: 1 }), "Host returned HTTP 500"],
    ["invalid JSON", reply(200, "nope"), "Invalid host response"],
    ["missing result", reply(200, {}), "Invalid host response"],
  ])("maps a %s like the desktop does", async (_, response, message) => {
    cacheHost();
    fetchMock.mockResolvedValueOnce(response);
    await expect(webRemoteRequest(WEB_MACHINE_ID, "sessions.list", {})).rejects.toBe(message);
  });

  it("never turns a proxy failure into a definitive host rejection", async () => {
    cacheHost();
    for (const proxyError of ["unreachable", "incomplete", "refused"]) {
      fetchMock.mockResolvedValueOnce(reply(502, { proxyError, error: "x" }));
      const reason = await webRemoteRequest(WEB_MACHINE_ID, "commands.dispatch", {}).catch(String);
      expect(reason).not.toMatch(/^Host rejected request:/);
    }
  });

  it("treats a network failure as an uncertain result", async () => {
    cacheHost();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(webRemoteRequest(WEB_MACHINE_ID, "sessions.list", {})).rejects.toBe(
      "The host request did not complete. Retry to confirm its result.",
    );
  });

  it("refuses a host whose identity changed", async () => {
    cacheHost();
    fetchMock.mockResolvedValueOnce(reply(200, { result: { ...describeResult, environmentId: "env-2" } }));
    await expect(webRemoteRequest(WEB_MACHINE_ID, "environment.describe", {})).rejects.toBe(
      "Host identity changed. Add this machine again before continuing.",
    );
  });
});

describe("webMachines", () => {
  const changed = vi.fn();
  beforeEach(() => {
    changed.mockReset();
    window.addEventListener("monocode:remote-machines", changed);
  });
  afterEach(() => window.removeEventListener("monocode:remote-machines", changed));

  it("lists the host and tells the UI's machine listeners to refresh", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { result: describeResult }));
    await expect(webMachines()).resolves.toEqual([
      { id: WEB_MACHINE_ID, name: "mac", endpoint: location.origin, environmentId: "env-1", ssh: null },
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("re-learns a re-paired host instead of keeping a stale identity", async () => {
    cacheHost("old-env");
    fetchMock
      .mockResolvedValueOnce(reply(200, { result: describeResult }))
      .mockResolvedValueOnce(reply(200, { result: [] }));
    await expect(webMachines()).resolves.toMatchObject([{ environmentId: "env-1" }]);
    await webRemoteRequest(WEB_MACHINE_ID, "sessions.list", {});
    expect(sent(1).environmentId).toBe("env-1");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("uses the same event name as the desktop machine list", () => {
    refreshRemoteMachines();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps listing the last known host while it is offline", async () => {
    cacheHost();
    fetchMock.mockResolvedValueOnce(reply(502, { proxyError: "unreachable" }));
    await expect(webMachines()).resolves.toMatchObject([{ environmentId: "env-1" }]);
    expect(changed).not.toHaveBeenCalled();
  });

  it("lists nothing when the host was never reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(webMachines()).resolves.toEqual([]);
  });

  it("ignores a host that speaks another protocol version", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { result: { ...describeResult, protocolVersion: 2 } }));
    await expect(webMachines()).resolves.toEqual([]);
  });

  it("forgets the host on Settings > Remove so it can be learned again", () => {
    cacheHost();
    forgetWebMachine();
    expect(localStorage.getItem("monocode.web.machine.v1")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

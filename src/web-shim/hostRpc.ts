import {
  HOST_PROTOCOL_VERSION,
  REMOTE_PROVIDERS,
  type HostDescriptor,
  type RemoteMachine,
} from "../features/connections/model/protocol";

export const WEB_MACHINE_ID = "web-host";
export const KEY_HEADER = "X-MonoCode-Web-Key";
const KEY_STORAGE = "monocode.web.key.v1";
const MACHINE_STORAGE = "monocode.web.machine.v1";
const MACHINES_CHANGED = "monocode:remote-machines";

// Same texts as src-tauri/src/remote.rs: the UI keys retry/outbox behavior off them.
const UNREACHABLE =
  "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
const INCOMPLETE =
  "The host request did not complete. Retry to confirm its result.";

type Identity = { environmentId: string; name: string };
type ProxyFailure = { proxyError: "unreachable" | "incomplete" | "refused"; message?: string };

let identity: Identity | undefined = readCachedIdentity();

const envelope = (environmentId: string | null, method: string, params: unknown) =>
  JSON.stringify({ version: HOST_PROTOCOL_VERSION, environmentId, method, params });

const send = (key: string, body: string) =>
  fetch("/rpc", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", [KEY_HEADER]: key },
    body,
  });

/**
 * Moves the launch key from the URL fragment into this origin's storage. Any site can
 * navigate here with a made-up #key, so a new key replaces the stored one only once the
 * web server accepts it.
 */
export async function adoptLaunchKey(location: Location, history: History) {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  if (!key) return;
  history.replaceState(history.state, "", location.pathname + location.search);
  if (key === localStorage.getItem(KEY_STORAGE)) return;
  const probe = await send(key, envelope(null, "environment.describe", {})).catch(() => undefined);
  if (probe && probe.status !== 401) localStorage.setItem(KEY_STORAGE, key);
}

async function post(environmentId: string | null, method: string, params: unknown) {
  let response: Response;
  try {
    response = await send(localStorage.getItem(KEY_STORAGE) ?? "", envelope(environmentId, method, params));
  } catch {
    throw INCOMPLETE;
  }
  let value: { result?: unknown; error?: unknown } & Partial<ProxyFailure>;
  try {
    value = await response.json();
  } catch {
    throw "Invalid host response";
  }
  if (value.proxyError === "unreachable") throw UNREACHABLE;
  if (value.proxyError === "incomplete") throw INCOMPLETE;
  if (value.proxyError) throw `Web proxy refused the request: ${value.message ?? response.status}`;
  if (typeof value.error === "string") throw `Host rejected request: ${value.error}`;
  if (response.status !== 200) throw `Host returned HTTP ${response.status}`;
  if (!("result" in value)) throw "Invalid host response";
  return value.result;
}

function remember(next: Identity | undefined) {
  const changed = next?.environmentId !== identity?.environmentId || next?.name !== identity?.name;
  identity = next;
  if (next) localStorage.setItem(MACHINE_STORAGE, JSON.stringify(next));
  else localStorage.removeItem(MACHINE_STORAGE);
  if (changed) window.dispatchEvent(new Event(MACHINES_CHANGED));
}

async function describe() {
  const result = (await post(null, "environment.describe", {
    supportedProviders: REMOTE_PROVIDERS,
  })) as HostDescriptor;
  if (result?.protocolVersion !== HOST_PROTOCOL_VERSION || !result.environmentId)
    throw "This host is not compatible with this version of MonoCode";
  remember({ environmentId: result.environmentId, name: result.name });
}

const machineFor = (value: Identity): RemoteMachine => ({
  id: WEB_MACHINE_ID,
  name: value.name,
  endpoint: location.origin,
  environmentId: value.environmentId,
  ssh: null,
});

/** The single host behind the web proxy, re-read on every list so a re-paired host is picked up. */
export async function webMachines(): Promise<RemoteMachine[]> {
  try {
    await describe();
  } catch {
    // ponytail: offline or refused; the last known host keeps its projects listed as offline
  }
  return identity ? [machineFor(identity)] : [];
}

/** Settings > Remove: forget the host so the next machine list learns it again. */
export function forgetWebMachine() {
  remember(undefined);
  return null;
}

export async function webRemoteRequest(
  machineId: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  if (machineId !== WEB_MACHINE_ID) throw "Machine is no longer connected";
  if (!identity) await describe();
  const known = identity!;
  const result = await post(known.environmentId, method, params);
  if (
    method === "environment.describe" &&
    (result as HostDescriptor | null)?.environmentId !== known.environmentId
  ) {
    throw "Host identity changed. Add this machine again before continuing.";
  }
  return result;
}

function readCachedIdentity(): Identity | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(MACHINE_STORAGE) ?? "null");
    return typeof value?.environmentId === "string" && typeof value?.name === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export const resetForTests = () => {
  identity = readCachedIdentity();
};

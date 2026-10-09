import { useEffect, useState } from "react";
import { Loader } from "../../../shared/ui/icons";
import { HARNESS_LABEL } from "../../sessions/model/session";
import { remoteRequest } from "../model/connections";
import type { RemoteMachine, RemoteProvider } from "../model/protocol";

type Inventory = {
  mcp: Array<{ name: string; status: string; detail?: string }>;
  plugins: Array<{ name: string; enabled: boolean; version?: string; detail?: string }>;
};
type Loaded = Inventory & { skills: Array<{ name: string; description: string }> };

/** Providers whose MCP servers, plugins and skills the host can report. */
export const INVENTORY_PROVIDERS: readonly RemoteProvider[] = ["claude", "hermes", "opencode"];

const tone = (status: string) =>
  /^(connected|enabled)$/.test(status)
    ? "text-emerald-500"
    : /auth/.test(status)
      ? "text-amber-500"
      : /fail|error|disabled/.test(status)
        ? "text-red-400"
        : "text-content/45";

/** Read-only view of what each agent on a machine has: MCP servers, plugins, skills and commands. */
export function AgentSetupPanel({
  machine,
  providers,
}: {
  machine: RemoteMachine;
  providers: RemoteProvider[];
}) {
  const [provider, setProvider] = useState(providers[0]);
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!provider) return;
    let disposed = false;
    setData(undefined);
    setError("");
    void Promise.all([
      remoteRequest<Inventory>(machine.id, "agents.inventory", { provider }),
      remoteRequest<Loaded["skills"]>(machine.id, "skills.list", { provider }).catch(() => []),
    ])
      .then(([inventory, skills]) => {
        if (!disposed) setData({ ...inventory, skills });
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [machine.id, provider, refresh]);

  const section = (title: string, rows: Array<{ name: string; right?: string; tone?: string; note?: string }>) => (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[12px] font-medium text-content/70">
        {title} <span className="text-content/40">({rows.length})</span>
      </h4>
      {rows.length ? (
        <ul className="max-h-64 divide-y divide-stroke overflow-y-auto rounded-lg border border-stroke">
          {rows.map((row) => (
            <li key={row.name} className="flex items-baseline gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-content">{row.name}</div>
                {row.note ? <div className="truncate text-[11px] text-content/40">{row.note}</div> : null}
              </div>
              {row.right ? <span className={`shrink-0 text-[11px] ${row.tone ?? "text-content/45"}`}>{row.right}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-content/40">None on this machine.</p>
      )}
    </div>
  );

  return (
    <div
      role="group"
      aria-label={`Agent setup on ${machine.name}`}
      className="flex flex-col gap-4 border-t border-stroke bg-content/3 px-4 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {providers.map((id) => (
          <button
            key={id}
            className={`rounded-lg px-3 py-1.5 text-[12px] ${id === provider ? "bg-selection font-medium text-content" : "text-content/55 hover:bg-selection"}`}
            onClick={() => setProvider(id)}
          >
            {HARNESS_LABEL[id]}
          </button>
        ))}
        <button
          className="ml-auto text-[12px] text-content/50 hover:text-content"
          disabled={!data && !error}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-red-400">{error}</p>
      ) : !data ? (
        <div className="flex items-center gap-2 text-[12px] text-content/50">
          <Loader className="size-4 animate-spin" /> Asking {HARNESS_LABEL[provider!]} on {machine.name}…
        </div>
      ) : (
        <>
          {section("MCP servers", data.mcp.map((row) => ({
            name: row.name, right: row.status, tone: tone(row.status), note: row.detail,
          })))}
          {section("Plugins", data.plugins.map((row) => ({
            name: row.name,
            right: row.enabled ? "enabled" : "disabled",
            tone: tone(row.enabled ? "enabled" : "disabled"),
            note: [row.version, row.detail].filter(Boolean).join(" · "),
          })))}
          {section("Skills and commands", data.skills.map((row) => ({
            name: `/${row.name}`, note: row.description,
          })))}
          <p className="text-[11px] leading-relaxed text-content/40">
            Read-only. Install or sign in to these on the machine itself; secrets such as keys and
            headers never leave it.
          </p>
        </>
      )}
    </div>
  );
}

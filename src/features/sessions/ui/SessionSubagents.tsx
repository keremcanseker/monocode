import { CircleAlert, Square } from "../../../shared/ui/icons";
import { useNow } from "../../../shared/hooks/useNow";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { formatElapsed, type LiveSubagent } from "../model/transcriptActivity";
import { TerminalSpinner } from "./TerminalSpinner";

/**
 * The subagents a session is waiting on, under its sidebar card. Laid out like
 * an orchestration's agents: a count and how many are done, then a row for
 * every run that still needs looking at. Finished runs live in the count.
 */
export function SessionSubagents({
  subagents,
  onReveal,
}: {
  subagents: LiveSubagent[];
  onReveal: (blockId: string) => void;
}) {
  const total = subagents.length;
  const done = subagents.filter((agent) => agent.state === "done").length;
  const rows = subagents.filter((agent) => agent.state !== "done");
  return (
    <div className="relative mt-1.5">
      <div className="mb-0.5 flex items-center justify-between px-0.5 text-[11px] text-content/45">
        <span>
          {total} {total === 1 ? "subagent" : "subagents"}
        </span>
        <span className="tabular-nums">
          {done}/{total} done
        </span>
      </div>
      <div
        aria-label="Subagents"
        className="-mx-2 flex touch-pan-y flex-col gap-px"
        // The card under these rows opens the session on click; a row has
        // its own target, the run inside that session.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {rows.map((agent) => (
          <SubagentLine key={agent.blockId} agent={agent} onReveal={onReveal} />
        ))}
      </div>
    </div>
  );
}

function SubagentLine({
  agent,
  onReveal,
}: {
  agent: LiveSubagent;
  onReveal: (blockId: string) => void;
}) {
  const running = agent.state === "running";
  // Ticks here, in the row, so a second passing redraws one line.
  const now = useNow(running);
  const elapsed = formatElapsed(
    agent.durationMs ??
      (running && agent.startedAt != null ? now - agent.startedAt : null),
  );
  const steps = agent.steps === 1 ? "1 step" : `${agent.steps} steps`;
  const progress = running
    ? [agent.steps > 0 ? String(agent.steps) : "", elapsed ?? ""]
        .filter(Boolean)
        .join(" · ")
    : agent.state;
  return (
    <button
      type="button"
      title={[agent.brief, steps, elapsed].filter(Boolean).join(" · ")}
      aria-label={`Show subagent: ${agent.name}`}
      onClick={() => onReveal(agent.blockId)}
      // Named, because the whole session card is already a `group`.
      className="group/agent flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-content/10"
    >
      {/* The same face the run has in the transcript, so the two read as one. */}
      <span className="grid size-3.5 shrink-0 place-items-center">
        <ProjectMascot
          project={agent.name}
          active={running}
          className={`size-3.5 shrink-0 ${
            agent.state === "failed"
              ? "text-amber-400"
              : running
                ? "text-content/70"
                : "text-content/45"
          }`}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-content/80">
        {agent.name}
      </span>
      <span
        className={`flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${
          running
            ? "text-accent"
            : agent.state === "failed"
              ? "text-amber-400"
              : "text-content/45"
        }`}
      >
        {running ? (
          <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
        ) : agent.state === "failed" ? (
          <CircleAlert className="size-3" strokeWidth={1.75} />
        ) : (
          <Square className="size-3" strokeWidth={1.75} />
        )}
        {progress ? <span>{progress}</span> : null}
      </span>
    </button>
  );
}

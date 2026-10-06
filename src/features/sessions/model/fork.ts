import { canForkHarnessSession } from "../../../integrations/harness/core/registry";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { sessionThroughTurn } from "./handoff";
import {
  formatSessionTitle,
  newSession,
  sessionDisplayTitle,
  type Block,
  type Session,
} from "./session";

/**
 * An idle conversation its provider can copy into a new tab. An orchestration
 * worker's copy would read as another worker of its lead.
 */
export function canForkSession(
  session: Pick<
    Session,
    | "harness"
    | "cwd"
    | "providerSessionId"
    | "busy"
    | "inboxAsk"
    | "worktreeRemoved"
    | "orchestrationLeadId"
  >,
): boolean {
  return (
    !!session.providerSessionId &&
    !session.busy &&
    !session.inboxAsk &&
    !session.worktreeRemoved &&
    !session.orchestrationLeadId &&
    !isRemoteProjectPath(session.cwd) &&
    canForkHarnessSession(session.harness)
  );
}

const sentUser = (block: Block) => block.role === "user" && !block.draft;

/**
 * Where a fork after `turn` picks up: the whole conversation after the latest
 * turn, else the transcript entry the turn ended on. Null when that entry is
 * not known, as for turns from before forks recorded it.
 */
export function forkPoint(
  blocks: Block[],
  turn: Block[],
): { providerTurnId?: string } | null {
  const start = blocks.findIndex((block) => block.id === turn[0]?.id);
  const lastId = turn[turn.length - 1]?.id;
  const end = lastId ? blocks.findIndex((block) => block.id === lastId) : -1;
  if (start < 0 || end < start) return null;
  if (!blocks.slice(end + 1).some(sentUser)) return {};
  // Before a handoff the turns belong to another provider's conversation.
  if (blocks.some((block) => block.role === "handoff")) return null;
  // The turn's own end is on its last message, which may be one the
  // transcript folds in, like an orchestration's internal turns.
  for (let index = end; index >= start; index -= 1) {
    if (!sentUser(blocks[index])) continue;
    const providerTurnId = blocks[index].providerTurnId;
    return providerTurnId ? { providerTurnId } : null;
  }
  return null;
}

/** A new conversation carrying `source` through `turn`, or all of it. */
export function forkedSession(source: Session, turn?: Block[]): Session {
  const kept = turn ? sessionThroughTurn(source, turn).blocks : source.blocks;
  return {
    ...newSession(
      source.harness,
      source.cwd,
      source.model,
      source.runtimeMode,
      source.modelSettings,
    ),
    title: formatSessionTitle(
      source.harness,
      `${sessionDisplayTitle(source.title, source.harness)} (fork)`,
    ),
    blocks: kept.filter((block) => !block.draft),
    ...(source.worktreeCwd ? { worktreeCwd: source.worktreeCwd } : {}),
    ...(source.branch ? { branch: source.branch } : {}),
    ...(source.providerAccountId
      ? { providerAccountId: source.providerAccountId }
      : {}),
    // A copy of all of it holds what the source holds; a cut one reports its
    // own level on its first reply.
    ...(!turn && source.context ? { context: source.context } : {}),
  };
}

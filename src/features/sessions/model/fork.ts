import { canForkHarnessSession } from "../../../integrations/harness/core/registry";
import {
  claudeForkPoints,
  type ClaudePrompt,
} from "../../../platform/tauri/fs";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { promptText } from "./attachments";
import {
  formatSessionTitle,
  newSession,
  sessionDisplayTitle,
  type Block,
  type Session,
} from "./session";

/**
 * Where a fork cuts: before one of the user's messages, keeping everything
 * above it. `prefill` puts that message back into the new tab's composer.
 * Without one, a fork takes the whole conversation.
 */
export type ForkFrom = { beforeBlockId: string; prefill?: boolean };

/**
 * A conversation its provider can copy into a new tab. An orchestration
 * worker's copy would read as another worker of its lead.
 */
export function canForkSession(
  session: Pick<
    Session,
    | "harness"
    | "cwd"
    | "providerSessionId"
    | "inboxAsk"
    | "worktreeRemoved"
    | "orchestrationLeadId"
  >,
): boolean {
  return (
    !!session.providerSessionId &&
    !session.inboxAsk &&
    !session.worktreeRemoved &&
    !session.orchestrationLeadId &&
    !isRemoteProjectPath(session.cwd) &&
    canForkHarnessSession(session.harness)
  );
}

export const sentUser = (block: Block) => block.role === "user" && !block.draft;

/**
 * What a fork keeps: the blocks before `index`, with the message there to put
 * back in the composer when asked for, or all of them when `index` is -1. A
 * turn under way has no end to copy yet, so a fork of all of it taken while
 * one runs stops before the message that started it. Null when there is
 * nothing to fork yet.
 */
export function forkCut(
  session: Session,
  from?: ForkFrom,
): { index: number; prefill?: string } | null {
  let index = -1;
  if (from) {
    index = session.blocks.findIndex(
      (block) => block.id === from.beforeBlockId,
    );
    if (index < 0) return null;
  } else if (session.busy) {
    // A message sent into a running turn has no start of its own.
    for (let at = session.blocks.length - 1; at >= 0; at -= 1) {
      const block = session.blocks[at];
      if (sentUser(block) && block.startedAt != null) {
        index = at;
        break;
      }
    }
    // Busy with that turn over is a compaction rewriting the record.
    if (index < 0 || session.blocks[index].durationMs != null) return null;
  }
  const prefill = from?.prefill ? session.blocks[index].text : "";
  if (
    index >= 0 &&
    !prefill &&
    !session.blocks.slice(0, index).some(sentUser)
  ) {
    return null;
  }
  return { index, ...(prefill ? { prefill } : {}) };
}

/** A fork after `turn`: up to the next message, or all of it after the last. */
export function forkAfterTurn(
  blocks: Block[],
  turn: Block[],
): ForkFrom | undefined {
  const lastId = turn[turn.length - 1]?.id;
  const end = blocks.findIndex((block) => block.id === lastId);
  const next = end < 0 ? undefined : blocks.slice(end + 1).find(sentUser);
  return next ? { beforeBlockId: next.id } : undefined;
}

/**
 * Where the conversation stood before `blocks[index]` by the turn ends
 * MonoCode recorded: the end of the last turn above it, which may be one the
 * transcript folds in, like an orchestration's internal turns. Null when that
 * turn did not record one, as turns from before forks did not.
 */
export function recordedForkPoint(
  blocks: Block[],
  index: number,
): string | null {
  // Before a handoff the turns belong to another provider's conversation.
  if (blocks.some((block) => block.role === "handoff")) return null;
  for (let at = index - 1; at >= 0; at -= 1) {
    if (sentUser(blocks[at])) return blocks[at].providerTurnId ?? null;
  }
  return null;
}

const promptKey = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/^Ultrathink:\n/, "")
    .trim();

const blockKey = (block: Block) =>
  promptKey(promptText(block.text, block.attachments));

/**
 * Where the conversation stood before `blocks[index]` by the provider's own
 * record: the message before that prompt there. Prompts are told apart by
 * their text, and only when it occurs there as often as here, so a message
 * the record does not show is never matched to another one.
 */
export function promptForkPoint(
  blocks: Block[],
  index: number,
  prompts: readonly ClaudePrompt[],
): string | null {
  const target = blocks[index];
  const text = target && sentUser(target) ? blockKey(target) : "";
  if (!text) return null;
  const same = blocks.filter(
    (block) => sentUser(block) && blockKey(block) === text,
  );
  const recorded = prompts.filter((prompt) => promptKey(prompt.text) === text);
  if (recorded.length !== same.length) return null;
  return recorded[same.indexOf(target)]?.after ?? null;
}

/**
 * Where a fork cuts the provider's copy: before `session.blocks[index]`, or
 * at the end of all of it when `index` is -1. The end is pinned now, so what
 * the source goes on to say before the fork's first message stays out of it.
 * Turns from before MonoCode recorded their ends are looked up in Claude's own
 * transcript, which also knows where a compaction left the conversation.
 */
export async function forkPointBefore(
  session: Session,
  index: number,
): Promise<string | null> {
  const recorded = recordedForkPoint(
    session.blocks,
    index < 0 ? session.blocks.length : index,
  );
  if (session.harness !== "claude" || !session.providerSessionId) {
    return recorded;
  }
  if (recorded && index >= 0) return recorded;
  const points = await claudeForkPoints(
    session.providerSessionId,
    session.providerAccountId,
  ).catch(() => null);
  if (index < 0) return points?.last ?? recorded;
  return points ? promptForkPoint(session.blocks, index, points.prompts) : null;
}

/** A new conversation carrying `blocks` of `source`, or all of it. */
export function forkedSession(source: Session, blocks?: Block[]): Session {
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
    blocks: (blocks ?? source.blocks).filter((block) => !block.draft),
    ...(source.worktreeCwd ? { worktreeCwd: source.worktreeCwd } : {}),
    ...(source.branch ? { branch: source.branch } : {}),
    ...(source.providerAccountId
      ? { providerAccountId: source.providerAccountId }
      : {}),
    // A copy of all of it holds what the source holds; a cut one reports its
    // own level on its first reply.
    ...(!blocks && source.context ? { context: source.context } : {}),
  };
}

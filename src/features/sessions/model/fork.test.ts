import { describe, expect, it } from "vitest";
import { forkPoint, forkedSession } from "./fork";
import { newSession, type Block, type Session } from "./session";

function conversation(): Session {
  return {
    ...newSession("claude", "/repo", "claude:claude-sonnet-5"),
    title: "claude · Fix login",
    providerSessionId: "sess_src",
    worktreeCwd: "/repo-worktrees/login",
    context: { used: 40_000, window: 200_000 },
    blocks: [
      { id: "u1", role: "user", text: "look", providerTurnId: "entry_1" },
      { id: "a1", role: "assistant", text: "looked" },
      { id: "u2", role: "user", text: "fix it", providerTurnId: "entry_2" },
      { id: "a2", role: "assistant", text: "fixed" },
      { id: "d1", role: "user", text: "later", draft: true },
    ],
  };
}

const turn = (session: Session, ...ids: string[]): Block[] =>
  session.blocks.filter((block) => ids.includes(block.id));

describe("forkPoint", () => {
  it("copies all of it after the latest turn, a draft notwithstanding", () => {
    const source = conversation();
    expect(forkPoint(source.blocks, turn(source, "u2", "a2"))).toEqual({});
  });

  it("cuts an earlier turn where Claude recorded its end", () => {
    const source = conversation();
    expect(forkPoint(source.blocks, turn(source, "u1", "a1"))).toEqual({
      providerTurnId: "entry_1",
    });
  });

  it("counts a hidden notice after the latest turn as part of it", () => {
    const source = conversation();
    const blocks: Block[] = [
      ...source.blocks,
      { id: "n1", role: "system", text: "Not logged in", notice: "error" },
    ];
    expect(forkPoint(blocks, turn(source, "u2", "a2"))).toEqual({});
  });

  it("ends a turn where the internal turns folded into it ended", () => {
    const source = conversation();
    const blocks: Block[] = [
      source.blocks[0],
      source.blocks[1],
      {
        id: "i1",
        role: "user",
        text: "keep going",
        internal: true,
        providerTurnId: "entry_internal",
      },
      { id: "ai1", role: "assistant", text: "kept going" },
      ...source.blocks.slice(2),
    ];
    // The transcript leaves the internal prompt out of the turn it folds into.
    const folded = blocks.filter((block) =>
      ["u1", "a1", "ai1"].includes(block.id),
    );
    expect(forkPoint(blocks, folded)).toEqual({
      providerTurnId: "entry_internal",
    });
  });

  it("has no point for an earlier turn without a recorded end, or after a handoff", () => {
    const source = conversation();
    const unrecorded = {
      ...source,
      blocks: source.blocks.map((block) =>
        block.id === "u1" ? { ...block, providerTurnId: undefined } : block,
      ),
    };
    expect(
      forkPoint(unrecorded.blocks, turn(unrecorded, "u1", "a1")),
    ).toBeNull();
    const handedOff: Block[] = [
      { id: "h1", role: "handoff", text: "" },
      ...source.blocks,
    ];
    expect(forkPoint(handedOff, turn(source, "u1", "a1"))).toBeNull();
  });
});

describe("forkedSession", () => {
  it("keeps the conversation through the turn in a new session on the same working copy", () => {
    const source = conversation();
    const fork = forkedSession(source, turn(source, "u1", "a1"));
    expect(fork.id).not.toBe(source.id);
    expect(fork.title).toBe("claude · Fix login (fork)");
    expect(fork.blocks.map((block) => block.id)).toEqual(["u1", "a1"]);
    expect(fork.worktreeCwd).toBe("/repo-worktrees/login");
    expect(fork.providerSessionId).toBeUndefined();
    expect(fork.context).toBeUndefined();
  });

  it("copies all of it without the draft, at the source's context level", () => {
    const source = conversation();
    const fork = forkedSession(source);
    expect(fork.blocks.map((block) => block.id)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);
    expect(fork.context).toEqual(source.context);
  });
});

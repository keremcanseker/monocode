import { beforeEach, describe, expect, it, vi } from "vitest";

const { claudeForkPoints } = vi.hoisted(() => ({ claudeForkPoints: vi.fn() }));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claudeForkPoints,
}));

import {
  forkAfterTurn,
  forkCut,
  forkPointBefore,
  forkedSession,
  promptForkPoint,
  recordedForkPoint,
} from "./fork";
import { newSession, type Block, type Session } from "./session";

beforeEach(() => {
  claudeForkPoints.mockReset();
});

function conversation(): Session {
  return {
    ...newSession("claude", "/repo", "claude:claude-sonnet-5"),
    title: "claude · Fix login",
    providerSessionId: "sess_src",
    worktreeCwd: "/repo-worktrees/login",
    context: { used: 40_000, window: 200_000 },
    blocks: [
      {
        id: "u1",
        role: "user",
        text: "look",
        startedAt: 1,
        durationMs: 10,
        providerTurnId: "entry_1",
      },
      { id: "a1", role: "assistant", text: "looked" },
      {
        id: "u2",
        role: "user",
        text: "fix it",
        startedAt: 20,
        durationMs: 10,
        providerTurnId: "entry_2",
      },
      { id: "a2", role: "assistant", text: "fixed" },
      { id: "d1", role: "user", text: "later", draft: true },
    ],
  };
}

const at = (session: Session, id: string) =>
  session.blocks.findIndex((block) => block.id === id);

describe("recordedForkPoint", () => {
  it("cuts where the turn above the message ended", () => {
    const source = conversation();
    expect(recordedForkPoint(source.blocks, at(source, "u2"))).toBe("entry_1");
  });

  it("takes the end of internal turns the transcript folds in", () => {
    const blocks: Block[] = [
      ...conversation().blocks.slice(0, 2),
      {
        id: "i1",
        role: "user",
        text: "keep going",
        internal: true,
        providerTurnId: "entry_internal",
      },
      { id: "ai1", role: "assistant", text: "kept going" },
      ...conversation().blocks.slice(2),
    ];
    expect(recordedForkPoint(blocks, 4)).toBe("entry_internal");
  });

  it("has none for an unrecorded turn, or after a handoff", () => {
    const source = conversation();
    const unrecorded = source.blocks.map((block) =>
      block.id === "u1" ? { ...block, providerTurnId: undefined } : block,
    );
    expect(recordedForkPoint(unrecorded, at(source, "u2"))).toBeNull();
    const handedOff: Block[] = [
      { id: "h1", role: "handoff", text: "" },
      ...source.blocks,
    ];
    expect(recordedForkPoint(handedOff, 3)).toBeNull();
  });
});

describe("promptForkPoint", () => {
  const blocks: Block[] = [
    { id: "u1", role: "user", text: "look" },
    { id: "a1", role: "assistant", text: "looked" },
    { id: "u2", role: "user", text: "again" },
    { id: "a2", role: "assistant", text: "looked again" },
    { id: "u3", role: "user", text: "again" },
  ];

  it("finds the same occurrence of the message in Claude's record", () => {
    const prompts = [
      { text: "look", after: null },
      { text: "Ultrathink:\nagain", after: "m1" },
      { text: "again", after: "m2" },
    ];
    expect(promptForkPoint(blocks, 2, prompts)).toBe("m1");
    expect(promptForkPoint(blocks, 4, prompts)).toBe("m2");
  });

  it("does not guess when the record shows the text a different number of times", () => {
    const prompts = [
      { text: "look", after: null },
      { text: "again", after: "m2" },
    ];
    expect(promptForkPoint(blocks, 4, prompts)).toBeNull();
    expect(promptForkPoint(blocks, 2, [])).toBeNull();
  });
});

describe("forkCut", () => {
  it("keeps all of an idle conversation", () => {
    expect(forkCut(conversation())).toEqual({ index: -1 });
  });

  it("stops before the message that started a turn under way", () => {
    const source = conversation();
    const running: Session = {
      ...source,
      busy: true,
      blocks: [
        ...source.blocks.slice(0, 4),
        { id: "u3", role: "user", text: "and the tests", startedAt: 40 },
        { id: "a3", role: "assistant", text: "work" },
        // Sent into the running turn, so it has no start of its own.
        { id: "s3", role: "user", text: "the e2e ones too" },
        { id: "a4", role: "assistant", text: "more work", streaming: true },
      ],
    };
    expect(forkCut(running)).toEqual({ index: 4 });
    // Busy after the last turn ended: a compaction is rewriting the record.
    expect(forkCut({ ...source, busy: true })).toBeNull();
  });

  it("cuts before a message and hands it back for the composer", () => {
    const source = conversation();
    expect(forkCut(source, { beforeBlockId: "u2", prefill: true })).toEqual({
      index: 2,
      prefill: "fix it",
    });
    expect(forkCut(source, { beforeBlockId: "u1", prefill: true })).toEqual({
      index: 0,
      prefill: "look",
    });
    expect(forkCut(source, { beforeBlockId: "u1" })).toBeNull();
    expect(forkCut(source, { beforeBlockId: "gone" })).toBeNull();
  });
});

describe("forkPointBefore", () => {
  it("cuts where MonoCode recorded the turn above ending, without reading the record", async () => {
    const source = conversation();
    await expect(forkPointBefore(source, at(source, "u2"))).resolves.toBe(
      "entry_1",
    );
    expect(claudeForkPoints).not.toHaveBeenCalled();
  });

  it("looks up older turns and the current end in Claude's transcript", async () => {
    const source = conversation();
    const unrecorded: Session = {
      ...source,
      blocks: source.blocks.map(({ providerTurnId: _, ...block }) => block),
    };
    claudeForkPoints.mockResolvedValue({
      prompts: [
        { text: "look", after: null },
        { text: "fix it", after: "msg_before_fix" },
      ],
      last: "msg_last",
    });
    await expect(forkPointBefore(unrecorded, at(source, "u2"))).resolves.toBe(
      "msg_before_fix",
    );
    // All of it is pinned at the transcript's end, past any compaction.
    await expect(forkPointBefore(source, -1)).resolves.toBe("msg_last");
    claudeForkPoints.mockRejectedValue(new Error("no transcript"));
    await expect(forkPointBefore(source, -1)).resolves.toBe("entry_2");
    await expect(
      forkPointBefore(unrecorded, at(source, "u2")),
    ).resolves.toBeNull();
  });
});

describe("forkAfterTurn", () => {
  it("cuts before the next message, or takes all of it after the last", () => {
    const source = conversation();
    expect(forkAfterTurn(source.blocks, source.blocks.slice(0, 2))).toEqual({
      beforeBlockId: "u2",
    });
    expect(
      forkAfterTurn(source.blocks, source.blocks.slice(2, 4)),
    ).toBeUndefined();
  });
});

describe("forkedSession", () => {
  it("carries the kept blocks into a new session on the same working copy", () => {
    const source = conversation();
    const fork = forkedSession(source, source.blocks.slice(0, 2));
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

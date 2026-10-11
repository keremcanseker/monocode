import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeForkPointsFrom, readClaudeForkPoints } from "./claude-fork";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The same records as claude_fork_points_cut_after_the_message_before_each_prompt in src-tauri/src/fs.rs.
const records = [
  { type: "attachment", uuid: "hook", parentUuid: null },
  { type: "user", uuid: "p1", parentUuid: "hook", message: { content: "first" } },
  { type: "assistant", uuid: "a1", parentUuid: "p1", message: { content: [{ type: "text", text: "ok" }] } },
  { type: "user", uuid: "r1", parentUuid: "a1", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] } },
  { type: "attachment", uuid: "q1", parentUuid: "r1", attachment: { type: "queued_command", commandMode: "prompt", prompt: [{ type: "text", text: "steer" }] } },
  { type: "attachment", uuid: "n1", parentUuid: "q1", attachment: { type: "queued_command", commandMode: "task-notification", prompt: "task done" } },
  { type: "assistant", uuid: "a2", parentUuid: "n1", message: { content: [{ type: "text", text: "done" }] } },
  { type: "user", uuid: "sub", parentUuid: "a2", isSidechain: true, message: { content: "subagent task" } },
  { type: "system", uuid: "s1", parentUuid: "a2", subtype: "stop_hook_summary" },
  { type: "user", uuid: "m1", parentUuid: "s1", isMeta: true, message: { content: "caveat" } },
  { type: "user", uuid: "cs", parentUuid: "m1", isCompactSummary: true, message: { content: "summary" } },
  { type: "attachment", uuid: "loop1", parentUuid: "loop2" },
  { type: "attachment", uuid: "loop2", parentUuid: "loop1" },
  { type: "user", uuid: "p2", parentUuid: "loop1", message: { content: "second" } },
  { type: "user", uuid: "p3", parentUuid: "cs", message: { content: [{ type: "text", text: "third" }, { type: "text", text: "/tmp/file.txt" }] } },
];
const expected = {
  prompts: [
    { text: "first", after: null },
    { text: "steer", after: "r1" },
    { text: "second", after: null },
    { text: "third", after: "cs" },
  ],
  last: "p3",
};

it("cuts after the message before each prompt, as the desktop does", () => {
  expect(claudeForkPointsFrom(records.map((r) => JSON.stringify(r)).join("\n"))).toEqual(expected);
});

it("finds the transcript in any project folder and refuses odd ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "monocode-claude-fork-"));
  dirs.push(dir);
  mkdirSync(join(dir, "projects", "-work-app"), { recursive: true });
  writeFileSync(
    join(dir, "projects", "-work-app", "abc-123.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n"),
  );
  expect(readClaudeForkPoints("abc-123", dir)).toEqual(expected);
  expect(readClaudeForkPoints("missing", dir)).toEqual({ prompts: [], last: null });
  expect(() => readClaudeForkPoints("../escape", dir)).toThrow("Invalid");
});

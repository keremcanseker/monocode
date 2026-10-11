import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeForkPoints } from "../src/platform/tauri/fs";

type Entry = { message: boolean; parent: string | null };
type Json = { [key: string]: unknown };

const asRecord = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;

/** Claude keeps a session's transcript in the folder of the project it ran in. */
export function claudeTranscriptPath(
  providerSessionId: string,
  configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(providerSessionId))
    throw new Error("Invalid Claude provider session id");
  const root = join(configDir, "projects");
  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const project of projects) {
    const candidate = join(root, project, `${providerSessionId}.jsonl`);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this project
    }
  }
}

/** The desktop's `claude_fork_points` (src-tauri/src/fs.rs), for the host. */
export function readClaudeForkPoints(
  providerSessionId: string,
  configDir?: string,
): ClaudeForkPoints | null {
  const path = claudeTranscriptPath(providerSessionId, configDir);
  if (!path) return { prompts: [], last: null };
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return claudeForkPointsFrom(content);
}

export function claudeForkPointsFrom(content: string): ClaudeForkPoints {
  // Every entry's parent, and whether it is a message, to step back over
  // the attachments and system rows between a prompt and the message before.
  const entries = new Map<string, Entry>();
  const prompts: { text: string; parent: string | null }[] = [];
  let last: string | null = null;
  for (const line of content.split("\n")) {
    let record: Json | undefined;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    const uuid = record?.uuid;
    if (!record || typeof uuid !== "string") continue;
    const kind = record.type;
    const parent = typeof record.parentUuid === "string" ? record.parentUuid : null;
    const message = kind === "user" || kind === "assistant";
    entries.set(uuid, { message, parent });
    if (record.isSidechain === true) continue;
    if (message) last = uuid;
    const attachment = asRecord(record.attachment);
    const text =
      kind === "user" && record.isMeta !== true && record.isCompactSummary !== true
        ? promptText(asRecord(record.message)?.content)
        : // A message sent while Claude works waits in a queue and is
          // recorded where Claude takes it in.
          kind === "attachment" &&
            attachment?.type === "queued_command" &&
            attachment.commandMode === "prompt"
          ? promptText(attachment.prompt)
          : undefined;
    if (text !== undefined) prompts.push({ text, parent });
  }
  return {
    prompts: prompts.map(({ text, parent }) => ({
      text,
      after: messageAtOrBefore(entries, parent),
    })),
    last,
  };
}

/** What the user typed, as Claude recorded it; a tool result is not a prompt. */
function promptText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const blocks = content.map(asRecord);
  if (blocks.some((block) => block?.type === "tool_result")) return undefined;
  const text = blocks.find(
    (block) => block?.type === "text" && typeof block.text === "string",
  );
  return text?.text as string | undefined;
}

function messageAtOrBefore(
  entries: Map<string, Entry>,
  id: string | null,
): string | null {
  // Bounded, so a parent loop in a damaged file cannot hang the read.
  for (let step = 0; step <= entries.size && id; step += 1) {
    const entry = entries.get(id);
    if (!entry) return null;
    if (entry.message) return id;
    id = entry.parent;
  }
  return null;
}

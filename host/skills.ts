import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import { discoverClaudeCommands } from "../src/integrations/harness/providers/claude/claudeCatalog";

// Same `/name` token and injected wording as src/features/skills/model/skills.ts, which the host
// does not bundle (it pulls in the desktop harness registry).
const SKILL_TOKEN_RE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;

export type HostSkill = { name: string; description: string };
type HermesSkill = HostSkill & { path: string };

/** Frontmatter `name` and `description`, including a folded (`>`/`|`) description. */
export function parseSkillFrontmatter(text: string): Partial<HostSkill> {
  const yaml = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const out: Partial<HostSkill> = {};
  const lines = yaml.split(/\r?\n/);
  const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");
  for (let i = 0; i < lines.length; i++) {
    const match = /^(name|description):\s*(.*)$/.exec(lines[i]!);
    if (!match) continue;
    let value = match[2]!.trim();
    if (/^[>|]/.test(value)) {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1]!)) folded.push(lines[++i]!.trim());
      value = folded.filter(Boolean).join(" ");
    }
    out[match[1] as keyof HostSkill] = unquote(value);
  }
  return out;
}

// Hermes keeps skills as ~/.hermes/skills/<category>/<skill>/SKILL.md.
function hermesSkills(): HermesSkill[] {
  const root = join(homedir(), ".hermes", "skills");
  const out: HermesSkill[] = [];
  const dirs = (path: string) => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => join(path, entry.name));
    } catch {
      return [];
    }
  };
  for (const dir of dirs(root).flatMap((category) => [category, ...dirs(category)])) {
    const path = join(dir, "SKILL.md");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const meta = parseSkillFrontmatter(text);
    const name = meta.name || dir.split("/").pop()!;
    out.push({ name, description: meta.description ?? "", path });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listHostSkills(provider: RemoteProvider, cwd: string): Promise<HostSkill[]> {
  if (provider === "claude") return discoverClaudeCommands(cwd);
  if (provider === "hermes") return hermesSkills().map(({ name, description }) => ({ name, description }));
  return [];
}

/**
 * Hermes sends unknown `/name` text to the model as-is, so the host inlines the
 * skill body like local MonoCode does. Claude Code expands `/name` itself.
 */
export function withHermesSkills(text: string, skills = hermesSkills()): string {
  const names = new Set([...text.matchAll(SKILL_TOKEN_RE)].map((match) => match[2]!));
  const blocks = skills
    .filter((skill) => names.has(skill.name))
    .map((skill) => `## /${skill.name}\n\n${readFileSync(skill.path, "utf8").trim()}`);
  if (!blocks.length) return text;
  return [
    "The user invoked skill(s) with /name. Follow every instruction in each skill body.",
    "",
    blocks.join("\n\n"),
    "",
    "---",
    "",
    text,
  ].join("\n");
}

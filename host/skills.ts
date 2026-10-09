import { execFile, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import {
  discoverClaudeCommands,
  discoverClaudeMcp,
} from "../src/integrations/harness/providers/claude/claudeCatalog";
import { providerLaunch, resolveProvider } from "./process";

const exec = promisify(execFile);

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
  if (provider === "opencode")
    return withOpenCodeServer(cwd, async (get) => {
      const rows = await get("/command");
      return (Array.isArray(rows) ? rows : []).flatMap((row: { name?: unknown; description?: unknown }) =>
        typeof row?.name === "string"
          ? [{ name: row.name, description: typeof row.description === "string" ? row.description : "" }]
          : []);
    });
  return [];
}

export type HostMcpServer = { name: string; status: string; detail?: string };
export type HostPlugin = { name: string; enabled: boolean; version?: string; detail?: string };
export type HostInventory = { mcp: HostMcpServer[]; plugins: HostPlugin[] };

async function run(provider: RemoteProvider, args: string[], cwd: string): Promise<string> {
  const launch = await providerLaunch(await resolveProvider(provider), args);
  const { stdout } = await exec(launch.command, launch.args, { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/** Top-level names under Hermes' `mcp_servers`; values (URLs, headers, env) never leave the host. */
export function hermesMcpNames(yaml: string): string[] {
  return yaml.split(/\r?\n/).flatMap((line) => /^([^\s#][^:]*):\s*$/.exec(line)?.[1]?.trim() ?? []);
}

/** MCP servers and plugins each provider loads on this host, without secrets. */
export async function hostInventory(provider: RemoteProvider, cwd: string): Promise<HostInventory> {
  if (provider === "claude") {
    const [mcp, plugins] = await Promise.all([
      discoverClaudeMcp(cwd),
      run("claude", ["plugin", "list", "--json"], cwd).then((out) => JSON.parse(out) as unknown[]),
    ]);
    return {
      mcp: mcp.map((row) => ({
        name: row.name,
        status: row.status,
        detail: [row.scope, row.tools ? `${row.tools} tools` : ""].filter(Boolean).join(" · "),
      })),
      plugins: plugins.flatMap((row) => {
        const rec = row as { id?: unknown; enabled?: unknown; version?: unknown; scope?: unknown };
        return typeof rec.id === "string" ? [{
          name: rec.id,
          enabled: rec.enabled !== false,
          version: typeof rec.version === "string" ? rec.version : undefined,
          detail: typeof rec.scope === "string" ? rec.scope : undefined,
        }] : [];
      }),
    };
  }
  if (provider === "hermes") {
    const [config, plugins] = await Promise.all([
      run("hermes", ["config", "get", "mcp_servers"], cwd).catch(() => ""),
      run("hermes", ["plugins", "list", "--json"], cwd).then((out) => JSON.parse(out) as unknown[]),
    ]);
    return {
      mcp: hermesMcpNames(config).map((name) => ({ name, status: "configured" })),
      plugins: plugins.flatMap((row) => {
        const rec = row as { name?: unknown; status?: unknown; version?: unknown; source?: unknown };
        return typeof rec.name === "string" ? [{
          name: rec.name,
          enabled: rec.status === "enabled",
          version: typeof rec.version === "string" ? rec.version : undefined,
          detail: typeof rec.source === "string" ? rec.source : undefined,
        }] : [];
      }),
    };
  }
  if (provider === "opencode")
    return withOpenCodeServer(cwd, async (get) => {
      const [status, config] = await Promise.all([get("/mcp"), get("/config")]);
      const states = (status && typeof status === "object" ? status : {}) as Record<string, { status?: unknown }>;
      const configured = Object.keys((config as { mcp?: object })?.mcp ?? {});
      const plugins = (config as { plugin?: unknown })?.plugin;
      return {
        mcp: [...new Set([...configured, ...Object.keys(states)])].map((name) => ({
          name,
          status: typeof states[name]?.status === "string" ? String(states[name]!.status) : "configured",
        })),
        plugins: (Array.isArray(plugins) ? plugins : []).flatMap((spec) =>
          typeof spec === "string" ? [{ name: spec, enabled: true }] : []),
      };
    });
  return { mcp: [], plugins: [] };
}

/** A throwaway `opencode serve` on a free loopback port, for read-only API calls. */
async function withOpenCodeServer<T>(cwd: string, use: (get: (path: string) => Promise<unknown>) => Promise<T>): Promise<T> {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port"))));
    });
  });
  const launch = await providerLaunch(await resolveProvider("opencode"), ["serve", "--hostname=127.0.0.1", `--port=${port}`]);
  const child = spawn(launch.command, launch.args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OpenCode server did not start")), 15_000);
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
        if (out.includes(`:${port}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("OpenCode server exited"));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    return await use(async (path) => {
      const url = `${base}${path}?directory=${encodeURIComponent(cwd)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`OpenCode ${path} returned ${response.status}`);
      return response.json();
    });
  } finally {
    child.kill();
  }
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

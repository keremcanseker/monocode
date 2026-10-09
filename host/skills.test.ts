import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillFrontmatter, withHermesSkills } from "./skills";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseSkillFrontmatter", () => {
  it("reads plain, quoted and folded fields", () => {
    expect(parseSkillFrontmatter("---\nname: post-yaz\ndescription: \"Post yazar\"\n---\nbody"))
      .toEqual({ name: "post-yaz", description: "Post yazar" });
    expect(parseSkillFrontmatter("---\nname: a\ndescription: >\n  first\n  second\n---\n"))
      .toEqual({ name: "a", description: "first second" });
    expect(parseSkillFrontmatter("no frontmatter")).toEqual({});
  });
});

describe("withHermesSkills", () => {
  it("inlines only the named skills and keeps the user text last", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-skills-"));
    dirs.push(dir);
    writeFileSync(join(dir, "post.md"), "---\nname: post-yaz\n---\nYAZ KURALLARI");
    const skills = [
      { name: "post-yaz", description: "", path: join(dir, "post.md") },
      { name: "hook-yaz", description: "", path: join(dir, "missing.md") },
    ];
    const out = withHermesSkills("/post-yaz süre hataları", skills);
    expect(out).toContain("## /post-yaz");
    expect(out).toContain("YAZ KURALLARI");
    expect(out.endsWith("/post-yaz süre hataları")).toBe(true);
    expect(withHermesSkills("düz mesaj /yok-boyle", skills)).toBe("düz mesaj /yok-boyle");
    expect(withHermesSkills("a/post-yaz", skills)).toBe("a/post-yaz");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSubagents } from "./SessionSubagents";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionSubagents", () => {
  it("counts finished runs and lists the rest with their progress", () => {
    vi.spyOn(Date, "now").mockReturnValue(31_000);
    const markup = renderToStaticMarkup(
      createElement(SessionSubagents, {
        subagents: [
          {
            blockId: "a",
            name: "Read the docs",
            brief: "Read the docs",
            state: "running",
            steps: 54,
            startedAt: 1_000,
          },
          {
            blockId: "b",
            name: "Scan the code",
            brief: "Scan the code",
            state: "done",
            steps: 72,
            startedAt: 1_000,
            durationMs: 9_000,
          },
          {
            blockId: "c",
            name: "Search forums",
            brief: "Search forums",
            state: "stopped",
            steps: 3,
            durationMs: 2_000,
          },
        ],
        onReveal: () => undefined,
      }),
    );

    expect(markup).toContain("3 subagents");
    expect(markup).toContain("1/3 done");
    expect(markup).toContain('aria-label="Show subagent: Read the docs"');
    expect(markup).toContain("54 · 30s");
    // A finished run lives in the count, not as a row.
    expect(markup).not.toContain("Scan the code");
    expect(markup).toContain("Search forums");
    expect(markup).toContain(">stopped<");
  });
});

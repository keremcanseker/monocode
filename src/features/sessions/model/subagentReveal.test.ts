import { describe, expect, it } from "vitest";
import { requestSubagentReveal, takeSubagentReveal } from "./subagentReveal";

describe("subagent reveal", () => {
  it("hands the block to its own session once, and only while fresh", () => {
    requestSubagentReveal("s1", "b1");
    expect(takeSubagentReveal("s2")).toBeNull();
    expect(takeSubagentReveal("s1")).toBe("b1");
    expect(takeSubagentReveal("s1")).toBeNull();

    requestSubagentReveal("s1", "b2");
    expect(takeSubagentReveal("s1", Date.now() + 60_000)).toBeNull();
    expect(takeSubagentReveal("s1")).toBeNull();
  });
});

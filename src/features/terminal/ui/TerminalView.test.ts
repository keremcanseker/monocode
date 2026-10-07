import { beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: true }));

import { openTerminalLink } from "./TerminalView";

beforeEach(() => {
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
});

describe("openTerminalLink", () => {
  it("opens http(s) links on Cmd+click only", () => {
    const url = "http://localhost:5173/";
    openTerminalLink({ metaKey: false } as MouseEvent, url);
    expect(openUrl).not.toHaveBeenCalled();
    openTerminalLink({ metaKey: true } as MouseEvent, url);
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("leaves other schemes alone", () => {
    openTerminalLink({ metaKey: true } as MouseEvent, "file:///etc/passwd");
    expect(openUrl).not.toHaveBeenCalled();
  });
});

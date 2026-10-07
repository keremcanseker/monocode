// @vitest-environment happy-dom
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeAll, describe, expect, it } from "vitest";
import { installTauriShim } from "./install";

beforeAll(() => installTauriShim());

describe("installTauriShim", () => {
  it("lets the boot-time window and webview calls resolve instead of throwing", async () => {
    const unlisten = await getCurrentWebviewWindow().listen("monocode://ping", () => {});
    expect(typeof unlisten).toBe("function");
    unlisten();
    expect(getCurrentWindow().label).toBe("main");
    await expect(getCurrentWindow().onFocusChanged(() => {})).resolves.toBeTypeOf("function");
    await expect(getCurrentWebview().onDragDropEvent(() => {})).resolves.toBeTypeOf("function");
  });

  it("routes commands through the browser handler", async () => {
    await expect(invoke("plugin:app|version")).resolves.toBe("web");
    await expect(invoke("workspace_get_snapshot")).rejects.toBe(
      "workspace_get_snapshot is not available in the browser",
    );
  });

  it("stays out of Tauri-only code paths", () => {
    expect(isTauri()).toBe(false);
    expect(convertFileSrc("/Users/me/logo.png")).toBe("data:,");
  });
});

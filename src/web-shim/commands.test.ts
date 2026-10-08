// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { OPEN_REMOTE_PROJECT_EVENT } from "../features/connections/model/connections";
import { dialogMessage, handleCommand, openUrl } from "./commands";

const ui = (answer = true) =>
  ({ confirm: vi.fn(() => answer), alert: vi.fn(), open: vi.fn() }) as unknown as Window & {
    confirm: ReturnType<typeof vi.fn>;
    alert: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };

describe("dialogMessage", () => {
  it.each([
    ["YesNo", true, "Yes"],
    ["YesNo", false, "No"],
    ["OkCancel", false, "Cancel"],
    [{ OkCancelCustom: ["Delete", "Keep"] }, true, "Delete"],
    [{ OkCancelCustom: ["Delete", "Keep"] }, false, "Keep"],
    [{ YesNoCancelCustom: ["Save", "Discard", "Cancel"] }, false, "Cancel"],
  ])("answers %j with the label plugin-dialog compares (%s)", (buttons, answer, label) => {
    const browser = ui(answer);
    expect(dialogMessage({ message: "Sure?", title: "Remove", buttons }, browser)).toBe(label);
    expect(browser.confirm).toHaveBeenCalledWith("Remove\n\nSure?");
  });

  it("shows a plain alert for informational messages", () => {
    const browser = ui();
    expect(dialogMessage({ message: "Done" }, browser)).toBe("Ok");
    expect(dialogMessage({ message: "Done", buttons: { OkCustom: "Got it" } }, browser)).toBe("Got it");
    expect(browser.alert).toHaveBeenCalledWith("Done");
  });
});

describe("openUrl", () => {
  it.each(["https://github.com/x", "http://localhost:3000", "mailto:a@b.c", "tel:+90"])("opens %s in a new tab", (url) => {
    const browser = ui();
    openUrl({ url }, browser);
    expect(browser.open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "vscode://x", ""])("refuses %j", (url) => {
    const browser = ui();
    expect(() => openUrl({ url }, browser)).toThrow();
    expect(browser.open).not.toHaveBeenCalled();
  });
});

describe("handleCommand", () => {
  it("rejects local-only commands with a plain string like Tauri does", async () => {
    await expect(handleCommand("pty_spawn", {})).rejects.toBe("pty_spawn is not available in the browser");
  });

  it.each([
    "set_window_background_blur",
    "keybindings_set_overrides",
    "plugin:window|set_title",
    "quick_composer_take",
    "reminder_take_open",
    "control_load",
  ])(
    "quietly ignores the desktop-only call %s",
    async (cmd) => {
      await expect(handleCommand(cmd, {})).resolves.toBeNull();
    },
  );

  it("has no reminders to load in the browser", async () => {
    await expect(handleCommand("reminder_list", {})).resolves.toEqual([]);
  });

  it("forgets the web host on remote_disconnect", async () => {
    localStorage.setItem("monocode.web.machine.v1", JSON.stringify({ environmentId: "env-1", name: "mac" }));
    await expect(handleCommand("remote_disconnect", { machineId: "web-host" })).resolves.toBeNull();
    expect(localStorage.getItem("monocode.web.machine.v1")).toBeNull();
  });

  it("opens the machine folder dialog in place of the local folder picker", async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, opened);
    await expect(
      handleCommand("plugin:dialog|open", { options: { directory: true, multiple: true } }),
    ).resolves.toBeNull();
    expect(opened).toHaveBeenCalledOnce();
    await expect(handleCommand("plugin:dialog|open", { options: { multiple: false } })).rejects.toBe(
      "plugin:dialog|open is not available in the browser",
    );
    expect(opened).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, opened);
  });

  it("reports a web app version", async () => {
    await expect(handleCommand("plugin:app|version", {})).resolves.toBe("web");
  });
});

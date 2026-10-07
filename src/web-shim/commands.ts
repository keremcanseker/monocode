import { forgetWebMachine, webMachines, webRemoteRequest } from "./hostRpc";

type Args = Record<string, unknown> | undefined;
type Buttons =
  | string
  | { OkCustom: string }
  | { OkCancelCustom: [string, string] }
  | { YesNoCancelCustom: [string, string, string] }
  | undefined;

const SAFE_URL = /^(https?|mailto|tel):/i;

/** Browser stand-in for plugin:dialog|message; returns the label Tauri would. */
export function dialogMessage(args: Args, ui = window): string {
  const text = [args?.title, args?.message].filter(Boolean).join("\n\n");
  const buttons = args?.buttons as Buttons;
  if (buttons === "YesNo") return ui.confirm(text) ? "Yes" : "No";
  if (buttons === "OkCancel") return ui.confirm(text) ? "Ok" : "Cancel";
  if (typeof buttons === "object" && "OkCancelCustom" in buttons) {
    const [ok, cancel] = buttons.OkCancelCustom;
    return ui.confirm(text) ? ok : cancel;
  }
  if (typeof buttons === "object" && "YesNoCancelCustom" in buttons) {
    const [yes, , cancel] = buttons.YesNoCancelCustom;
    return ui.confirm(text) ? yes : cancel;
  }
  ui.alert(text);
  return typeof buttons === "object" && "OkCustom" in buttons ? buttons.OkCustom : "Ok";
}

export function openUrl(args: Args, ui = window) {
  const url = String(args?.url ?? "");
  if (!SAFE_URL.test(url)) throw `Refusing to open ${url || "an empty URL"}`;
  ui.open(url, "_blank", "noopener,noreferrer");
  return null;
}

// Desktop-only setters and queues the UI fires at boot; quiet no-ops in a browser.
const QUIET = [
  "set_window_background_blur",
  "set_window_glass_enabled",
  "keybindings_set_overrides",
  "plugin:window|set_title",
  "reminder_configure",
  "reminder_register_window",
  "reminder_take_open",
  "quick_composer_take",
  "control_load",
];

const handlers: Record<string, (args: Args) => unknown> = {
  ...Object.fromEntries(QUIET.map((cmd) => [cmd, () => null])),
  reminder_list: () => [],
  remote_request: (args) =>
    webRemoteRequest(String(args?.machineId), String(args?.method), args?.params ?? {}),
  remote_machines: () => webMachines(),
  remote_disconnect: () => forgetWebMachine(),
  "plugin:dialog|message": (args) => dialogMessage(args),
  "plugin:opener|open_url": (args) => openUrl(args),
  "plugin:app|version": () => "web",
};

/** Every Tauri IPC call lands here; anything local-only rejects like a failed command. */
export async function handleCommand(cmd: string, args: Args): Promise<unknown> {
  const handler = handlers[cmd];
  if (!handler) throw `${cmd} is not available in the browser`;
  return handler(args);
}

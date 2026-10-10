import { adoptLaunchKey } from "./hostRpc";
import { installTauriShim } from "./install";
import "./web.css";

// Read by IS_WEB in src/platform/tauri/platform.ts, which loads after this.
document.documentElement.setAttribute("data-monocode-web", "");

// Pasting a new launch URL into an open tab only changes the fragment, which does not reload.
window.addEventListener("hashchange", () => {
  if (location.hash.includes("key=")) location.reload();
});

void adoptLaunchKey(window.location, window.history).finally(() => {
  installTauriShim();
  void import("../main");
});

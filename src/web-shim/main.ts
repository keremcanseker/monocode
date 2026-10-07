import { adoptLaunchKey } from "./hostRpc";
import { installTauriShim } from "./install";

// Pasting a new launch URL into an open tab only changes the fragment, which does not reload.
window.addEventListener("hashchange", () => {
  if (location.hash.includes("key=")) location.reload();
});

void adoptLaunchKey(window.location, window.history).finally(() => {
  installTauriShim();
  void import("../main");
});

import { useSyncExternalStore } from "react";
import { IS_WEB } from "../../platform/tauri/platform";

// Below this width the browser build turns the project rail and session sidebar into one drawer.
const PHONE_QUERY = "(max-width: 767px)";

export function isPhoneWeb(): boolean {
  return IS_WEB && typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  if (!IS_WEB || typeof matchMedia !== "function") return () => {};
  const query = matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True in the browser build on a phone-sized viewport; always false in the desktop app. */
export function usePhoneWeb(): boolean {
  return useSyncExternalStore(subscribe, isPhoneWeb, () => false);
}

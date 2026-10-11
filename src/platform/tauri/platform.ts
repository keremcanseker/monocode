export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** The browser build (src/web-shim) marks <html> before the app loads. */
export const IS_WEB =
  typeof document !== "undefined" &&
  document.documentElement.hasAttribute("data-monocode-web");

export const IS_WIN =
  typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

export const IS_LINUX =
  typeof navigator !== "undefined" && /Linux/i.test(navigator.platform);

/**
 * Native desktop blur on macOS/Windows; transparency-only glass on Linux.
 * None in a browser.
 */
export const HAS_NATIVE_GLASS = (IS_MAC || IS_WIN || IS_LINUX) && !IS_WEB;

export const MOD = IS_MAC ? "⌘" : "Ctrl+";
export const ALT = IS_MAC ? "⌥" : "Alt+";
export const SHIFT = IS_MAC ? "⇧" : "Shift+";

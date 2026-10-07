import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { handleCommand } from "./commands";

/** Stands in for the Tauri runtime so the unmodified desktop UI boots in a browser. */
export function installTauriShim() {
  mockWindows("main");
  mockIPC((cmd, args) => handleCommand(cmd, args as Record<string, unknown>), {
    shouldMockEvents: true,
  });
  // ponytail: local asset:// files do not exist in the browser; a blank data URL keeps <img> quiet
  (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: () => string } })
    .__TAURI_INTERNALS__.convertFileSrc = () => "data:,";
}

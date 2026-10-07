import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import desktop from "./vite.config";
import { monocodeWeb } from "./web/server";

// Browser build of the desktop UI: `npm run web:dev` / `npm run web` (see docs/web-mode.md).
export default defineConfig(async (env: ConfigEnv) => {
  const base = await (desktop as (env: ConfigEnv) => Promise<UserConfig>)(env);
  const config = mergeConfig(base, {
    plugins: [monocodeWeb()],
    server: { host: "127.0.0.1", port: 1430, strictPort: true, cors: false },
    preview: { host: "127.0.0.1", port: 1430, strictPort: true, cors: false },
    // The dependency scan reads index.html before the entry swap, so it never sees the shim.
    optimizeDeps: { include: ["@tauri-apps/api/mocks"] },
  });
  // ponytail: replaced after the merge, which would otherwise keep the quick composer page
  config.build.rollupOptions.input = { main: "index.html" };
  config.build.outDir = "build/web";
  config.server.hmr = true;
  return config;
});

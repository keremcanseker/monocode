import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// pdf.js fetches its decoders, fonts and CMaps by directory at runtime, so they
// ship under fixed names. The dev server reads them from node_modules.
function pdfjsResources(): Plugin {
  return {
    name: "pdfjs-resources",
    apply: "build",
    generateBundle() {
      for (const dir of ["wasm", "standard_fonts", "cmaps"]) {
        const from = `node_modules/pdfjs-dist/${dir}`;
        for (const name of readdirSync(from)) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${dir}/${name}`,
            source: readFileSync(`${from}/${name}`),
          });
        }
      }
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    plugins: [react(), tailwindcss(), pdfjsResources()],
    clearScreen: false,
    build: {
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
        },
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**"],
      },
    },
  };
});

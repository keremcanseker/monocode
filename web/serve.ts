import { fileURLToPath } from "node:url";
import { createWebServer, hostSettings, webSettings } from "./server.ts";

// `npm run web` and the container image: the built UI plus the /rpc gate (docs/web-mode.md).
const web = webSettings();
const host = hostSettings();
if (!host.token) console.warn(`MonoCode web: no valid host token at ${host.tokenFile}; /rpc is disabled`);
createWebServer(web, fileURLToPath(new URL("../build/web", import.meta.url)), host).listen(web.port, web.bind, () =>
  console.log(`MonoCode web: open ${web.url}`),
);

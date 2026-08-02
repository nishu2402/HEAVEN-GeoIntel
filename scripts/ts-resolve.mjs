/**
 * Preload shim — `node --import ./scripts/ts-resolve.mjs <script>`.
 *
 * Registers the resolve hook that teaches Node this repo's extensionless
 * imports (see ts-resolve-hooks.mjs). Used by the asset generators so they can
 * read the app's real modules instead of being told what the app contains.
 */

import { registerHooks } from "node:module";
import { resolve } from "./ts-resolve-hooks.mjs";

/* Node 22.15+ / 23.5+. The repo's .nvmrc pins 22 and CI runs 22, so this is
   only reachable on an older minor — worth a clear message rather than a
   confusing "cannot find module ./logo" thirty lines later. */
if (typeof registerHooks !== "function") {
  console.error(
    "This generator needs Node 22.15+ (module.registerHooks). Found " + process.version + ".",
  );
  process.exit(1);
}

registerHooks({ resolve });

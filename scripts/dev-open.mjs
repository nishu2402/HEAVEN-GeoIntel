// HEAVEN-GeoIntel — dev server that opens the app in your browser on launch.
//
// Next's dev server has no built-in "open the browser" flag, so this thin
// wrapper spawns `next dev`, watches its output for the Local URL + the "Ready"
// line it prints, and opens that URL in the default browser exactly once.
//
// It deliberately stays quiet when it shouldn't pop a window:
//   • only when stdout is a real terminal — so it never fires under CI, the
//     Playwright e2e web-server, or the editor/preview harness, all of which
//     spawn `npm run dev` with piped (non-TTY) I/O;
//   • honours BROWSER=none / NO_OPEN=1 as an explicit opt-out.
//
// Any extra args survive: `npm run dev -- -p 4000` forwards `-p 4000` to next,
// and the URL we open is read from what next actually prints (so a bumped port
// — 3001 when 3000 is busy — is handled correctly).

import { spawn } from "node:child_process";
import { platform } from "node:os";

const NEXT_BIN = "node_modules/next/dist/bin/next";
const forwarded = process.argv.slice(2);

// Interactive launch only. Piped stdout (CI, e2e, preview harness) → skip.
const canOpen =
  Boolean(process.stdout.isTTY) &&
  !process.env.CI &&
  !process.env.NO_OPEN &&
  process.env.BROWSER !== "none";

function openBrowser(url) {
  const os = platform();
  const [cmd, args] =
    os === "darwin"
      ? ["open", [url]]
      : os === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  // Detached + unref so the opener's lifetime is never tied to the dev process
  // (and vice-versa). Best-effort: a headless box with no opener just no-ops —
  // the URL is still printed in next's banner above.
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* no browser opener available — non-fatal */
  }
}

// stdin + stderr inherited for a normal terminal experience; stdout is piped so
// we can sniff the Ready line, then re-emitted byte-for-byte so next's banner
// still shows up unchanged.
const child = spawn(process.execPath, [NEXT_BIN, "dev", ...forwarded], {
  stdio: ["inherit", "pipe", "inherit"],
});

let opened = false;
let seenReady = false;
let localUrl = null;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i;

function maybeOpen() {
  if (opened || !canOpen) return;
  if (seenReady && localUrl) {
    opened = true;
    openBrowser(localUrl);
  }
}

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk); // keep next's output intact
  const text = chunk.toString();
  const match = text.match(URL_RE);
  if (match && !localUrl) {
    localUrl = match[0];
    // Fallback: if a future next version prints the URL but a differently
    // worded ready line we don't match, open shortly after the URL appears.
    setTimeout(() => {
      seenReady = true;
      maybeOpen();
    }, 4000).unref();
  }
  if (/\bready\b/i.test(text)) seenReady = true;
  maybeOpen();
});

// Forward termination so Ctrl-C / kill stop next cleanly, and mirror its exit
// status so `npm run dev` behaves exactly as before to anything watching it.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code) => process.exit(code ?? 0));

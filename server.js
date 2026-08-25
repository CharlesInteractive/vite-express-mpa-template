import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp, defaultDistDir } from "./server/app.js";
import { listenWithFallback } from "./server/listen.js";

const DEFAULT_PORT = 8006;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const pad = (n) => String(n).padStart(2, "0");

/** `[2026-08-25 09:05:03]` — sortable, and padded, unlike a bare Date getter. */
function timestamp(now = new Date()) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `[${date} ${time}]`;
}

const log = (message) => console.log(`${timestamp()} ${message}`);
const logHighlight = (message) =>
  console.log("\x1b[35m%s\x1b[0m", `${timestamp()} ${message}`);

/**
 * Read PORT from the environment. An unparseable value is a hard error rather
 * than a silent fallback: binding some other port than the one configured is
 * how a deploy ends up serving nothing behind a proxy.
 */
export function resolvePort(raw = process.env.PORT) {
  if (raw === undefined || raw === "") return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `Invalid PORT "${raw}": expected an integer between 0 and 65535.`,
    );
  }
  return port;
}

export async function start({
  distDir = defaultDistDir,
  port = resolvePort(),
  host = process.env.HOST || "0.0.0.0",
} = {}) {
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(
      `No build found at ${distDir} — run "npm run build" first.`,
    );
  }

  const server = createServer(createApp({ distDir }));

  const boundPort = await listenWithFallback(server, {
    port,
    host,
    onPortInUse: (busy, next) =>
      log(`Port ${busy} is already in use — trying ${next}…`),
  });

  logHighlight(
    `vite-express-mpa-template running on http://localhost:${boundPort}`,
  );

  installShutdownHandlers(server);
  return { server, port: boundPort };
}

function installShutdownHandlers(server) {
  let shuttingDown = false;

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;

      log(`${signal} received — shutting down.`);
      const forceExit = setTimeout(() => {
        log("Shutdown timed out — forcing exit.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref();

      server.closeIdleConnections();
      server.close(() => process.exit(0));
    });
  }
}

// Only start when run directly (`node server.js`), so tests and other callers
// can import createApp/start without binding a port.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  start().catch((err) => {
    console.error(`${timestamp()} ${err.message}`);
    process.exit(1);
  });
}

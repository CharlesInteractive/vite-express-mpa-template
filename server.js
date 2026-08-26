// `npm start` entry point.
//
// This file is a SCRIPT, not a module: it exports nothing and always starts a
// server when loaded. That is deliberate. It used to guard the call behind
// `import.meta.url === pathToFileURL(process.argv[1]).href` so tests could
// import from it — but process managers do not exec your script directly. pm2's
// fork mode spawns `node ProcessContainerFork.js`, which then imports the app
// without rewriting `process.argv[1]`, so the guard silently evaluated false and
// the process sat there "online", listening to nothing. Anything importable
// lives in server/ instead.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createApp, defaultDistDir } from "./server/app.js";
import { listenWithFallback } from "./server/listen.js";
import { portWasSpecified, resolveHost, resolvePort } from "./server/config.js";

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

async function start({
  distDir = defaultDistDir,
  port = resolvePort(),
  host = resolveHost(),
} = {}) {
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(
      `No build found at ${distDir} — run "npm run build" first.`,
    );
  }

  const server = createServer(createApp({ distDir }));

  // An explicit PORT is bind-or-die: something upstream (nginx, a load balancer,
  // a container port mapping) is configured for that exact number, and quietly
  // landing on the next one up is invisible — the process manager reports the
  // app healthy while every request 502s.
  const strictPort = portWasSpecified();

  const boundPort = await listenWithFallback(server, {
    port,
    host,
    maxAttempts: strictPort ? 1 : 10,
    onPortInUse: (busy, next) =>
      log(`Port ${busy} is already in use — trying ${next}…`),
  });

  // Print enough to answer "did it start, and as what?" from the logs alone.
  logHighlight(
    `vite-express-mpa-template listening on http://${host}:${boundPort}`,
  );
  log(
    `pid ${process.pid} • node ${process.version} • NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}`,
  );
  log(`serving ${distDir}`);

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

start().catch((err) => {
  const hint =
    err.code === "EADDRINUSE" && portWasSpecified()
      ? " (PORT was set explicitly, so it is not retried on the next port up.)"
      : "";
  console.error(`${timestamp()} ${err.message}${hint}`);
  process.exit(1);
});

const MAX_PORT = 65535;

/**
 * Listen on `port`, walking up to the next port each time one is already taken.
 *
 * Resolves with the port actually bound, which is not always the one asked for —
 * callers should log the resolved value rather than the requested one.
 *
 * Only EADDRINUSE triggers the walk. EACCES (a privileged port, or one the OS
 * has reserved) is a permissions problem that the next port up will not fix, so
 * it fails immediately with an explanation. Port 0 already means "let the OS
 * pick", so it is never retried.
 *
 * @param {import("node:http").Server} server
 * @param {{port: number, host?: string, maxAttempts?: number,
 *          onPortInUse?: (busy: number, next: number) => void}} options
 * @returns {Promise<number>} the bound port
 */
export function listenWithFallback(
  server,
  { port, host = "0.0.0.0", maxAttempts = 10, onPortInUse } = {},
) {
  return new Promise((resolve, reject) => {
    let current = port;
    let attempt = 0;

    const attemptListen = () => {
      attempt += 1;

      const cleanup = () => {
        server.removeListener("error", onError);
        server.removeListener("listening", onListening);
      };

      const onListening = () => {
        cleanup();
        resolve(server.address().port);
      };

      const onError = (err) => {
        cleanup();

        if (err.code === "EACCES") {
          reject(
            new Error(
              `Port ${current} requires elevated privileges (EACCES). ` +
                `Use a port above 1024, or run behind a reverse proxy.`,
              { cause: err },
            ),
          );
          return;
        }

        if (err.code !== "EADDRINUSE" || current === 0) {
          reject(err);
          return;
        }

        if (attempt >= maxAttempts || current >= MAX_PORT) {
          reject(
            new Error(
              `Could not find a free port: tried ${port}-${current} ` +
                `(${attempt} attempt${attempt === 1 ? "" : "s"}).`,
              { cause: err },
            ),
          );
          return;
        }

        const next = current + 1;
        onPortInUse?.(current, next);
        current = next;
        attemptListen();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(current, host);
    };

    attemptListen();
  });
}

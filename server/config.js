// Environment parsing for the server entry point.
//
// This lives apart from server.js on purpose: server.js is a script that always
// starts a server, so nothing may import it. Anything that needs to be read or
// tested without side effects belongs here.

export const DEFAULT_PORT = 8007;
export const DEFAULT_HOST = "0.0.0.0";

/**
 * Whether PORT was set explicitly, which decides how a busy port is handled:
 * an explicit port is bind-or-die (a proxy is configured for that exact number),
 * an implicit one walks to the next free port. See server.js.
 */
export function portWasSpecified(raw = process.env.PORT) {
  return raw !== undefined && raw !== "";
}

/**
 * Read PORT from the environment. An unparseable value is a hard error rather
 * than a silent fallback: binding some other port than the one configured is
 * how a deploy ends up serving nothing behind a proxy.
 */
export function resolvePort(raw = process.env.PORT) {
  if (!portWasSpecified(raw)) return DEFAULT_PORT;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `Invalid PORT "${raw}": expected an integer between 0 and 65535.`,
    );
  }
  return port;
}

/**
 * Read HOST from the environment. Defaults to every interface; behind a reverse
 * proxy set `HOST=127.0.0.1` so the port is not reachable from the internet
 * directly, bypassing the proxy and its TLS.
 */
export function resolveHost(raw = process.env.HOST) {
  return raw || DEFAULT_HOST;
}

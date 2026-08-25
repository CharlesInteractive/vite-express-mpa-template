import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import helmet from "helmet";
import { cspDirectives } from "./csp.js";

const isProduction = process.env.NODE_ENV === "production";

/** Repo-root `dist/`, the output of `npm run build`. */
export const defaultDistDir = join(import.meta.dirname, "..", "dist");

// Hashed filenames change on every build, so these can be cached forever.
const ONE_YEAR = "365d";
// Files copied verbatim from src/public/ keep their names across builds, so they
// get a long-but-not-immutable cache instead.
const ONE_WEEK = "7d";

const staticOptions = {
  dotfiles: "ignore",
  redirect: true, // /routea -> /routea/
};

const FALLBACK_404 = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404 — Not Found</title>
  </head>
  <body>
    <h1>404 — Not Found</h1>
    <p>That page does not exist. <a href="/">Go home</a>.</p>
  </body>
</html>
`;

/**
 * Build the Express app that serves a production build.
 *
 * Deliberately does not listen: server.js owns the port, and the tests build an
 * app over a temporary dist fixture (CI runs the suite before `npm run build`,
 * so nothing here may assume a real dist/ exists).
 */
export function createApp({ distDir = defaultDistDir } = {}) {
  const app = express();

  app.disable("x-powered-by");

  // Behind a reverse proxy (nginx, Cloudflare, a PaaS router) req.ip and
  // req.secure are only correct once Express is told to trust X-Forwarded-*.
  // Off by default: trusting those headers when nothing strips them lets a
  // client spoof its own address. Set TRUST_PROXY=1 for one proxy hop, or to
  // any value Express accepts ("loopback", a subnet, …).
  if (process.env.TRUST_PROXY) {
    const value = Number(process.env.TRUST_PROXY);
    app.set(
      "trust proxy",
      Number.isNaN(value) ? process.env.TRUST_PROXY : value,
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: { directives: cspDirectives },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // HSTS is a promise a browser remembers for a year, so it is only sent in
      // production — otherwise it would pin http://localhost to https.
      hsts: isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      // helmet's defaults also cover X-Content-Type-Options: nosniff and
      // X-XSS-Protection: 0 (the deprecated filter is worse than no filter).
    }),
  );

  // No body parser and no CORS: this app serves static files to same-origin
  // requests and reads no request bodies. If you add API routes, add
  // `express.json({ limit: "100kb" })` and an origin-allowlisted `cors({ origin: [...] })`
  // on those routes specifically rather than globally.

  app.use(
    "/assets",
    express.static(join(distDir, "assets"), {
      ...staticOptions,
      maxAge: ONE_YEAR,
      immutable: true,
    }),
  );

  app.use(
    "/fonts",
    express.static(join(distDir, "fonts"), {
      ...staticOptions,
      maxAge: ONE_WEEK,
    }),
  );

  app.use(
    express.static(distDir, {
      ...staticOptions,
      maxAge: 0,
      setHeaders(res, filePath) {
        // The whole content-hashing scheme depends on this: HTML must always be
        // revalidated, or a cached page will ask for asset hashes that no
        // longer exist after a deploy. See CLAUDE.md "Deployment".
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  const custom404 = join(distDir, "404.html");
  const has404Page = existsSync(custom404);

  // A real 404, not a redirect to "/". Redirecting would hand a `text/html`
  // body to a request for a missing hashed chunk, which breaks the
  // vite:preloadError recovery in src/reloadOnChunkError.js and produces
  // soft-404s for crawlers.
  app.use((req, res) => {
    res.status(404);
    res.setHeader("Cache-Control", "no-cache");
    if (has404Page) {
      res.sendFile(custom404);
    } else {
      res.type("html").send(FALLBACK_404);
    }
  });

  // Express identifies the error handler by its four-argument signature, so
  // `next` has to stay in the list even though it is never called.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("[server] unhandled error:", err);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).type("text/plain").send("Internal Server Error");
  });

  return app;
}

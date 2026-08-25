// @vitest-environment node
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { listenWithFallback } from "../server/listen.js";
import { resolvePort } from "../server.js";

// The suite builds its own dist fixture rather than using the real dist/: CI
// runs `npm run test` before `npm run build`, so nothing here may assume a
// build exists. `secret.txt` sits one level ABOVE the fixture's dist, which is
// what the path-traversal test tries to reach.
let tmpRoot;
let distDir;

const HASHED_ASSET = "app-abc123.js";

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "mpa-server-test-"));
  distDir = join(tmpRoot, "dist");

  await mkdir(join(distDir, "assets"), { recursive: true });
  await mkdir(join(distDir, "routea"), { recursive: true });
  await mkdir(join(distDir, "fonts"), { recursive: true });

  await writeFile(join(tmpRoot, "secret.txt"), "TOP_SECRET_FIXTURE_VALUE");
  await writeFile(
    join(distDir, "index.html"),
    "<!doctype html><html><head><title>Home</title></head><body>home</body></html>",
  );
  await writeFile(
    join(distDir, "routea", "index.html"),
    "<!doctype html><html><head><title>Route A</title></head><body>route a</body></html>",
  );
  await writeFile(join(distDir, "assets", HASHED_ASSET), "console.log(1);\n");
  await writeFile(join(distDir, "fonts", "demo.woff2"), "not-really-a-font");
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Run `fn` against a live server on an ephemeral port, then close it. */
async function withServer(fn, { app } = {}) {
  const server = createServer(app ?? createApp({ distDir }));
  const port = await listenWithFallback(server, { port: 0, host: "127.0.0.1" });
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    // fetch keeps connections alive, which would stall close().
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("security headers", () => {
  it("sets a CSP with the structural directives locked down", async () => {
    await withServer(async (base) => {
      const res = await fetch(base);
      const csp = res.headers.get("content-security-policy");

      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    });
  });

  it("does not allow inline scripts", async () => {
    await withServer(async (base) => {
      const res = await fetch(base);
      const csp = res.headers.get("content-security-policy");
      const scriptSrc = csp
        .split(";")
        .find((directive) => directive.trim().startsWith("script-src "));

      expect(scriptSrc).toBeTruthy();
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });
  });

  it("denies framing and sniffing, and hides the server stack", async () => {
    await withServer(async (base) => {
      const res = await fetch(base);

      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers.get("x-powered-by")).toBeNull();
    });
  });

  it("does not send CORS headers", async () => {
    await withServer(async (base) => {
      const res = await fetch(base, {
        headers: { Origin: "https://evil.test" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("omits HSTS outside production", async () => {
    // HSTS is a year-long promise; pinning http://localhost to https would make
    // local development unreachable.
    expect(process.env.NODE_ENV).not.toBe("production");
    await withServer(async (base) => {
      const res = await fetch(base);
      expect(res.headers.get("strict-transport-security")).toBeNull();
    });
  });
});

describe("caching", () => {
  it("serves HTML as no-cache", async () => {
    // The whole content-hashing scheme rests on this: cached HTML would ask for
    // asset hashes that no longer exist after a deploy.
    await withServer(async (base) => {
      const res = await fetch(base);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    });
  });

  it("serves hashed assets as immutable for a year", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/assets/${HASHED_ASSET}`);
      const cacheControl = res.headers.get("cache-control");

      expect(res.status).toBe(200);
      expect(cacheControl).toContain("max-age=31536000");
      expect(cacheControl).toContain("immutable");
    });
  });

  it("serves unhashed fonts with a long but revalidatable cache", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/fonts/demo.woff2`);

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).not.toContain("immutable");
    });
  });
});

describe("routing", () => {
  it("serves each page's prerendered HTML", async () => {
    await withServer(async (base) => {
      const home = await fetch(base);
      const routea = await fetch(`${base}/routea/`);

      expect(await home.text()).toContain("home");
      expect(await routea.text()).toContain("route a");
    });
  });

  it("answers an unknown path with a 404, not a redirect", async () => {
    // A redirect to "/" would hand a text/html body to a request for a missing
    // hashed chunk, defeating the vite:preloadError recovery in
    // src/reloadOnChunkError.js and producing soft-404s for crawlers.
    await withServer(async (base) => {
      const res = await fetch(`${base}/no/such/page`, { redirect: "manual" });

      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
    });
  });

  it("404s a missing hashed asset instead of serving HTML", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/assets/stale-deadbee.js`, {
        redirect: "manual",
      });
      expect(res.status).toBe(404);
    });
  });

  it("refuses to serve files outside dist/", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/%2e%2e%2fsecret.txt`, {
        redirect: "manual",
      });

      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain("TOP_SECRET_FIXTURE_VALUE");
    });
  });
});

describe("listenWithFallback", () => {
  it("moves to the next port when one is taken", async () => {
    const blocker = createServer();
    const blockedPort = await listenWithFallback(blocker, {
      port: 0,
      host: "127.0.0.1",
    });

    const server = createServer();
    const inUse = [];
    try {
      const bound = await listenWithFallback(server, {
        port: blockedPort,
        host: "127.0.0.1",
        onPortInUse: (busy, next) => inUse.push([busy, next]),
      });

      expect(bound).toBe(blockedPort + 1);
      expect(inUse).toEqual([[blockedPort, blockedPort + 1]]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it("gives up after maxAttempts", async () => {
    const blocker = createServer();
    const blockedPort = await listenWithFallback(blocker, {
      port: 0,
      host: "127.0.0.1",
    });

    const server = createServer();
    try {
      await expect(
        listenWithFallback(server, {
          port: blockedPort,
          host: "127.0.0.1",
          maxAttempts: 1,
        }),
      ).rejects.toThrow(/Could not find a free port/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});

describe("resolvePort", () => {
  it("defaults when PORT is unset or empty", () => {
    expect(resolvePort(undefined)).toBe(8006);
    expect(resolvePort("")).toBe(8006);
  });

  it("accepts a valid port", () => {
    expect(resolvePort("3000")).toBe(3000);
    expect(resolvePort("0")).toBe(0);
  });

  it("rejects a value that is not a usable port", () => {
    // Silently falling back would bind a port nothing is proxying to.
    for (const bad of ["not-a-port", "-1", "65536", "8080.5"]) {
      expect(() => resolvePort(bad)).toThrow(/Invalid PORT/);
    }
  });
});

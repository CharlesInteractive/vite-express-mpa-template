// pm2 process definition. Start with `pm2 start ecosystem.config.cjs`.
//
// The .cjs extension is load-bearing. package.json sets "type": "module", so a
// file named ecosystem.config.js is loaded as an ES module — and on Node 22 that
// fails *silently*: the `module.exports` assignment below does not throw, but
// `require()` hands back the (empty) ES module namespace, so pm2 sees a config
// with no `apps` at all. Verified on Node 22.14:
//
//   require("./ecosystem.config.js")  -> [Module: null prototype] {}   apps: undefined
//   require("./ecosystem.config.cjs") -> { apps: [ … ] }
//
// Run `npm run build` before starting — the server refuses to boot without a
// dist/ and says so.
module.exports = {
  apps: [
    {
      name: "vite-express-mpa-template",
      script: "server.js",
      // Relative to this file, so the config works wherever the repo is checked
      // out rather than hardcoding a deploy path.
      cwd: __dirname,
      // Left unset so this file stays portable. Omitted, pm2 runs the app with
      // whatever Node the pm2 DAEMON was started with — typically whichever nvm
      // version was default the first time you ran pm2, not what your shell has
      // now. On a box running several Node versions, pin it to the one in
      // .nvmrc (this template needs 22):
      //
      //   interpreter: "/root/.nvm/versions/node/v22.23.2/bin/node",
      //
      // That path carries an exact version, so remember it is a thing to update
      // when you upgrade Node — the app will fail to start if that version is
      // uninstalled.
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      // A boot failure (no build, port taken) exits 1 immediately. Without a
      // restart delay pm2 would spin on it and bury the reason in the log.
      restart_delay: 2000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        // Explicit, so the server binds this exact port or exits — the port
        // nginx proxies to is not something to guess at. See server/config.js.
        PORT: 8007,
        // Loopback only: nginx is the sole client, and binding 0.0.0.0 would
        // leave the app reachable directly, bypassing the proxy and its TLS.
        HOST: "127.0.0.1",
        // One proxy hop, so req.ip and req.secure read X-Forwarded-* correctly.
        // Requires nginx to set X-Forwarded-Proto — see the README.
        TRUST_PROXY: 1,
      },
    },
  ],
};

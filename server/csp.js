// Content-Security-Policy directives, in helmet's shape.
//
// This is the one file you edit per site: adding a third-party script, font,
// analytics endpoint or embed means adding its host to the right directive
// here, not touching server/app.js.
//
// helmet is configured with `useDefaults: true`, so directives not listed below
// keep helmet's defaults — notably `script-src-attr 'none'`, which blocks inline
// event handlers (onclick="…") outright.

const isProduction = process.env.NODE_ENV === "production";

export const cspDirectives = {
  "default-src": ["'self'"],

  // NOTE: no 'unsafe-inline' here on purpose. This template's build emits zero
  // inline scripts — every entry is an external, hashed `<script type="module">`
  // — so the strictest policy costs nothing out of the box.
  //
  // Google Tag Manager's container snippet and some AdSense paths ARE inline
  // scripts and will be blocked. If your site uses them, either add
  // "'unsafe-inline'" to the list below (simple, weaker) or serve a per-request
  // nonce (stronger; see https://helmetjs.github.io/#content-security-policy).
  "script-src": [
    "'self'",
    "www.clarity.ms",
    "scripts.clarity.ms",
    "www.googletagmanager.com",
    "www.google.com",
    "pagead2.googlesyndication.com",
    "js.memberful.com",
    "static.cloudflareinsights.com",
  ],

  // 'unsafe-inline' is required here: Typekit injects styles, and inline
  // `style=` attributes count as inline styles under CSP.
  "style-src": [
    "'self'",
    "'unsafe-inline'",
    "use.typekit.net",
    "p.typekit.net",
  ],

  "font-src": ["'self'", "use.typekit.net", "www.gstatic.com", "data:"],

  "img-src": [
    "'self'",
    "*.clarity.ms",
    "p.typekit.net",
    "www.google.com",
    "www.gstatic.com",
    "pagead2.googlesyndication.com",
    "googleads.g.doubleclick.net",
    "data:",
    "blob:",
  ],

  "connect-src": [
    "'self'",
    "*.clarity.ms",
    "*.google-analytics.com",
    "*.analytics.google.com",
    "googleads.g.doubleclick.net",
    "ep1.adtrafficquality.google",
    "ep2.adtrafficquality.google",
  ],

  "frame-src": [
    "'self'",
    "www.youtube.com",
    "www.youtube-nocookie.com",
    "www.google.com",
  ],

  // Structural hardening: nothing may embed this site, inject a <base> tag,
  // load a plugin, or point a form at another origin.
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "form-action": ["'self'"],

  // Only meaningful over HTTPS, and it interferes with plain-http local runs,
  // so it is production-only. `null` removes helmet's default.
  "upgrade-insecure-requests": isProduction ? [] : null,
};

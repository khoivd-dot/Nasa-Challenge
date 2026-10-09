import { defineConfig } from 'vite';

// The only places the built site may load from: itself, NASA's SPHEREx archive
// on S3 and IMCCE's SkyBoT service. Inline styles are needed for style=""
// attributes; fonts are inlined as data: URLs. GitHub Pages cannot send
// headers, so the policy ships as a <meta> tag (frame-ancestors is ignored
// there). Dev mode skips it so Vite's hot reload keeps working.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self' https://nasa-irsa-spherex.s3.amazonaws.com https://ssp.imcce.fr",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

// Relative base so the build works at https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  plugins: [csp],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});

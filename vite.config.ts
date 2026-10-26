import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const apiOrigin = 'http://127.0.0.1:8788';
const sameOriginRequests = new WeakSet<object>();
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'onechamp-local-origin',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        try { if (request.headers.origin && new URL(request.headers.origin).host === request.headers.host) sameOriginRequests.add(request); }
        catch { /* Invalid origin stays untrusted. */ }
        next();
      });
    },
  }],
  server: {
    allowedHosts: ['.app.github.dev'],
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.dev.vars*', '**/.wrangler/**'] },
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            // Normalize only same-origin dev requests, including private Codespaces forwarding.
            // Cross-origin requests keep their Origin and are rejected by the backend.
            if (sameOriginRequests.has(request)) proxyRequest.setHeader('Origin', apiOrigin);
          });
        },
      },
    },
  },
});

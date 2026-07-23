import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

// Runs the Vercel-style functions in api/ inside the Vite dev server, so
// local dev matches production without needing `vercel dev`. Handlers are
// loaded through ssrLoadModule (TS transform included) on every request,
// which also gives them hot reload.
function apiDevPlugin(): Plugin {
  const routes: Record<string, string> = {
    '/tracks': '/api/tracks.ts',
    '/track-url': '/api/track-url.ts',
  };
  return {
    name: 'api-dev',
    configureServer(server: ViteDevServer) {
      try {
        process.loadEnvFile('.env');
      } catch {
        // no .env — handlers will fail env validation with a clear message
      }
      server.middlewares.use('/api', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const modulePath = routes[url.pathname.replace(/\/$/, '')];
        if (!modulePath) {
          next();
          return;
        }
        const request = Object.assign(req, {
          query: Object.fromEntries(url.searchParams),
        });
        const response = Object.assign(res, {
          status(code: number) {
            res.statusCode = code;
            return response;
          },
          json(body: unknown) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(body));
            return response;
          },
        });
        server
          .ssrLoadModule(modulePath)
          .then((module) => module.default(request, response))
          .catch(next);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevPlugin()],
});

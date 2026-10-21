import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Dev-only proxy for the AI harness: POST /api/<provider>/* -> the provider API, adding the key from .env
 * server-side so it never ends up in the browser bundle:
 *   /api/mistral    -> https://api.mistral.ai/v1      (MISTRAL_STUDIO_API_KEY)
 *   /api/openrouter -> https://openrouter.ai/api/v1   (OPEN_ROUTER_API_KEY)
 */
function devProxy(route: string, upstream: string, key: string | undefined, envName: string): Plugin {
  return {
    name: `dev-proxy-${route}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`/api/${route}`, async (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (!key) {
          res.statusCode = 501;
          res.end(JSON.stringify({ message: `${envName} missing in .env` }));
          return;
        }
        if (req.method === 'GET' && req.url === '/status') {
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try {
          const r = await fetch(upstream + req.url, {
            method: req.method,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'X-Title': 'CHONK FU' },
            body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
          });
          res.statusCode = r.status;
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ message: String(e) }));
        }
      });
    },
  };
}

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
    plugins: [
      devProxy('mistral', 'https://api.mistral.ai/v1', env.MISTRAL_STUDIO_API_KEY, 'MISTRAL_STUDIO_API_KEY'),
      devProxy('openrouter', 'https://openrouter.ai/api/v1', env.OPEN_ROUTER_API_KEY, 'OPEN_ROUTER_API_KEY'),
    ],
  };
});

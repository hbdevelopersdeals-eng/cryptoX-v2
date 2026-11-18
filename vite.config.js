import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPABASE_CSP_PLACEHOLDER, applySupabaseCsp } from './scripts/csp-origin.mjs';
import { swVersion } from './src/lib/pwa.js';

const SW_PLACEHOLDER = '__CX_SW_VERSION__';

/**
 * Substitutes the Supabase origin into the Content-Security-Policy at build
 * time, from the same VITE_SUPABASE_URL the browser client reads.
 *
 * Two documents carry the policy: index.html (a meta tag, handled by the
 * transformIndexHtml hook) and public/_headers (copied verbatim into the build,
 * so it needs rewriting once the bundle is written). Both must be handled —
 * whichever one the host honours, they have to agree.
 */
function supabaseCspPlugin(supabaseUrl) {
  const substitute = (text) => applySupabaseCsp(text, supabaseUrl);

  return {
    name: 'cryptox-supabase-csp',

    transformIndexHtml(html) {
      return substitute(html);
    },

    writeBundle(options) {
      const dir = options.dir || 'dist';
      const file = resolve(dir, '_headers');
      if (!existsSync(file)) return;
      const source = readFileSync(file, 'utf8');
      if (!source.includes(SUPABASE_CSP_PLACEHOLDER)) return;
      writeFileSync(file, substitute(source), 'utf8');
    },

    // A token surviving into the output is an invalid CSP source expression,
    // which fails closed but confusingly. Make that a build error instead.
    closeBundle() {
      const dir = this.meta?.watchMode ? null : 'dist';
      if (!dir) return;
      for (const name of ['index.html', '_headers']) {
        const path = resolve(dir, name);
        if (!existsSync(path)) continue;
        if (readFileSync(path, 'utf8').includes(SUPABASE_CSP_PLACEHOLDER)) {
          this.error(
            `${name} still contains ${SUPABASE_CSP_PLACEHOLDER}. The policy was not substituted; ` +
              'every blocked request would fail with a confusing "Failed to fetch".'
          );
        }
      }
    }
  };
}

/**
 * Stamps the service-worker cache version with this build's identity.
 *
 * `public/sw.js` ships with the literal `__CX_SW_VERSION__`. Left unstamped, the
 * cache name would be identical in every release — which is exactly how a
 * browser kept serving a fixed bug from an old shell. A surviving placeholder is
 * a build error rather than a warning, for the same reason the CSP one is: the
 * failure it causes (a release that never reaches the user) is invisible at
 * runtime and impossible to diagnose from a bug report.
 */
function serviceWorkerVersionPlugin({ version, stamp }) {
  const cacheVersion = swVersion({ version, stamp });

  return {
    name: 'cryptox-sw-version',

    closeBundle() {
      if (this.meta?.watchMode) return;
      const file = resolve('dist', 'sw.js');
      if (!existsSync(file)) return;
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.split(SW_PLACEHOLDER).join(cacheVersion), 'utf8');
      if (readFileSync(file, 'utf8').includes(SW_PLACEHOLDER)) {
        this.error('dist/sw.js still contains the cache-version placeholder; releases would not replace each other.');
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix so VITE_ variables are read too. loadEnv merges .env and
  // .env.local, which is where the Supabase URL is configured.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      supabaseCspPlugin(env.VITE_SUPABASE_URL),
      serviceWorkerVersionPlugin({
        version: env.VITE_APP_VERSION || 'dev',
        stamp: env.VITE_BUILD_STAMP || 'unknown'
      })
    ],
    server: {
      host: '127.0.0.1'
    },
    build: {
      rollupOptions: {
        output: {
          // Keep the auth/vendor SDK out of the critical entry chunk so the first
          // paint stays small; both chunks are still loaded at boot, in parallel.
          manualChunks: {
            supabase: ['@supabase/supabase-js'],
            'react-vendor': ['react', 'react-dom', 'react-router-dom']
          }
        }
      }
    }
  };
});

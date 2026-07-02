import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import react from '@astrojs/react';

// SEC-6: public/_headers is committed with wildcard *.convex.cloud/.site
// origins as a template. At build time this hook narrows the CSP to the ONE
// deployment configured in PUBLIC_CONVEX_URL (a wildcard would let injected
// script talk to any Convex tenant, weakening CSP as an exfiltration
// control). Without the env var the Convex origins are REMOVED, not left
// wildcarded: a build that cannot know its backend gets no backend allowance.
const { PUBLIC_CONVEX_URL } = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const convexCspHeaders = () => ({
  name: 'wai:csp-convex-deployment-origin',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      const headersPath = fileURLToPath(new URL('_headers', dir));
      let text = await readFile(headersPath, 'utf8');
      if (PUBLIC_CONVEX_URL) {
        const deployment = new URL(PUBLIC_CONVEX_URL);
        text = text
          .replaceAll('https://*.convex.cloud', deployment.origin)
          .replaceAll('wss://*.convex.cloud', `wss://${deployment.host}`)
          .replaceAll(
            'https://*.convex.site',
            deployment.origin.replace('.convex.cloud', '.convex.site'),
          );
        logger.info(`CSP narrowed to Convex deployment ${deployment.host}`);
      } else {
        text = text
          .replaceAll(' https://*.convex.cloud', '')
          .replaceAll(' wss://*.convex.cloud', '')
          .replaceAll(' https://*.convex.site', '');
        logger.warn(
          'PUBLIC_CONVEX_URL not set: Convex origins stripped from the CSP (fail closed)',
        );
      }
      await writeFile(headersPath, text);
    },
  },
});

// English-first, Arabic front door. The Arabic RTL mirror lives under /ar.
// See the vault: [[01 Branding]] and the language decision in 02 Platform.
// React powers the member portal islands (Convex Auth is client-side).
export default defineConfig({
  site: 'https://waiorg.me',
  integrations: [react(), convexCspHeaders()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ar'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});

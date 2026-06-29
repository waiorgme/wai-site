import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// English-first, Arabic front door. The Arabic RTL mirror lives under /ar.
// See the vault: [[01 Branding]] and the language decision in 02 Platform.
// React powers the member portal islands (Convex Auth is client-side).
export default defineConfig({
  site: 'https://waiorg.me',
  integrations: [react()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ar'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});

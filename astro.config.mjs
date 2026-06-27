import { defineConfig } from 'astro/config';

// English-first, Arabic front door. The Arabic RTL mirror lives under /ar.
// See the vault: [[01 Branding]] and the language decision in 02 Platform.
export default defineConfig({
  site: 'https://waiorg.me',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ar'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});

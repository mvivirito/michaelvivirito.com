// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeExternalLinks from 'rehype-external-links';

// https://astro.build/config
export default defineConfig({
  site: 'https://michaelvivirito.com',
  // Emit /page.html (not /page/index.html) so every existing URL is preserved.
  build: { format: 'file' },
  integrations: [sitemap()],
  markdown: {
    // Restore target="_blank" on external links in article markdown.
    rehypePlugins: [
      [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
    ],
  },
});

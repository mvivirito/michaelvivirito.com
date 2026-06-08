// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeExternalLinks from 'rehype-external-links';

// https://astro.build/config
export default defineConfig({
  site: 'https://michaelvivirito.com',
  // Emit /page.html (not /page/index.html) so every existing URL is preserved.
  build: { format: 'file' },
  integrations: [
    sitemap({
      // build.format:'file' emits /page.html, so make sitemap URLs match the
      // canonical .html paths instead of the default extensionless ones.
      serialize(item) {
        const url = new URL(item.url);
        if (url.pathname !== '/' && !url.pathname.endsWith('.html')) {
          url.pathname = url.pathname.replace(/\/$/, '') + '.html';
        }
        item.url = url.toString();
        return item;
      },
    }),
  ],
  markdown: {
    // Restore target="_blank" on external links in article markdown.
    rehypePlugins: [
      [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
    ],
  },
});

import { OGImageRoute } from 'astro-og-canvas';
import { getCollection } from 'astro:content';

// Generate a social-card PNG per article at /og/<slug>.png.
const entries = await getCollection('articles', ({ data }) => !data.draft);
const pages = Object.fromEntries(entries.map((e) => [e.id, e.data]));

export const { getStaticPaths, GET } = await OGImageRoute({
  param: 'route',
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [
      [4, 8, 6],
      [8, 18, 10],
    ],
    border: { color: [34, 197, 94], width: 12, side: 'inline-start' },
    padding: 60,
    font: {
      title: {
        color: [224, 255, 224],
        size: 64,
        weight: 'Bold',
        lineHeight: 1.15,
        families: ['JetBrains Mono'],
      },
      description: {
        color: [150, 200, 160],
        size: 28,
        lineHeight: 1.4,
        families: ['Inter'],
      },
    },
    fonts: [
      'https://api.fontsource.org/v1/fonts/jetbrains-mono/latin-700-normal.ttf',
      'https://api.fontsource.org/v1/fonts/inter/latin-400-normal.ttf',
    ],
  }),
});

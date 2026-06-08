import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

// Served at /feed.xml. Pulls straight from the articles collection, so a new
// post shows up here automatically — no hand-editing the feed.
export async function GET(context) {
  const articles = (await getCollection('articles', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  return rss({
    title: 'Michael Vivirito: Blog',
    description:
      'OpenWorld, civic action, FreeBSD, networking, and SRE writing. Building tools and writing about infrastructure.',
    site: context.site,
    items: articles.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/articles/${post.id}.html`,
    })),
    customData: `<language>en-us</language>`,
  });
}

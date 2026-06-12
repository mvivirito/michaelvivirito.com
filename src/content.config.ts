import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Blog articles. Add a new post by dropping a markdown file in
// src/content/articles/<slug>.md with the frontmatter below — the blog index,
// RSS feed, and sitemap all pick it up automatically.
const articles = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    /** Optional last-modified date; bumps BlogPosting.dateModified when set. */
    updated: z.coerce.date().optional(),
    keywords: z.string().optional(),
    ogTitle: z.string().optional(),
    ogDescription: z.string().optional(),
    /**
     * Optional per-article social-card image. Path-or-URL; defaults to the
     * site portrait when unset. See README "Writing a new post" for the
     * upgrade path to /pix/og/<slug>.jpg images.
     */
    ogImage: z.string().optional(),
    badges: z.array(z.string()).default([]),
    related: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };

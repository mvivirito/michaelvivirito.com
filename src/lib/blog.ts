import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'articles'>;

/** Posts per page on the paginated blog index. */
export const PAGE_SIZE = 10;

/** kebab-case a badge/tag for use in a URL: "Indie Web" -> "indie-web". */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** All non-draft posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('articles', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export interface TagInfo {
  name: string;
  slug: string;
  posts: Post[];
}

/** Build the tag taxonomy from post badges, keyed by slug. */
export async function getTags(): Promise<Map<string, TagInfo>> {
  const posts = await getPosts();
  const map = new Map<string, TagInfo>();
  for (const post of posts) {
    for (const tag of post.data.badges) {
      const slug = tagSlug(tag);
      if (!slug) continue;
      if (!map.has(slug)) map.set(slug, { name: tag, slug, posts: [] });
      map.get(slug)!.posts.push(post);
    }
  }
  return map;
}

/** Approximate reading time from the raw markdown body (~200 wpm). */
export function readingTime(body: string | undefined): string {
  const words = (body ?? '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

/** Newer/older neighbours for a post, given the newest-first list. */
export function prevNext(posts: Post[], id: string): { newer: Post | null; older: Post | null } {
  const i = posts.findIndex((p) => p.id === id);
  return {
    newer: i > 0 ? posts[i - 1] : null,
    older: i >= 0 && i < posts.length - 1 ? posts[i + 1] : null,
  };
}

/** Related posts by shared badges, most overlap first, excluding self. */
export function relatedByTags(posts: Post[], post: Post, limit = 3): Post[] {
  const tags = new Set(post.data.badges);
  return posts
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: p.data.badges.filter((b) => tags.has(b)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.data.date.valueOf() - a.p.data.date.valueOf())
    .slice(0, limit)
    .map((x) => x.p);
}

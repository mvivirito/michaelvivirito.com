# michaelvivirito.com

Personal site for Michael Vivirito, Lead Site Reliability Engineer.

Topics: Kubernetes, FreeBSD, networking, AWS, and self-hosted infrastructure.

## Stack

[Astro](https://astro.build) static site. Same dark terminal/TUI aesthetic
(Catppuccin Mocha, monospace) as before, now with a build step so the nav,
head, and footer live in one place and blog posts are plain markdown.

- **Pages** (`src/pages/*.astro`) wrap content in `src/layouts/BaseLayout.astro`.
- **Nav / Footer** are single components (`src/components/`) — edit once.
- **Articles** are a content collection: drop a markdown file and the blog
  index, RSS feed, and sitemap all update themselves.
- Output is 100% static HTML/CSS, deployed to Cloudflare Pages.
- URLs are preserved: `build.format: 'file'` emits `/page.html`, matching the
  old hand-written paths so no inbound link or search result breaks.

## Develop

```sh
bun install
bun run dev        # local dev server with hot reload
bun run build      # static build into dist/
bun run preview    # serve the built dist/ locally
```

## Add a blog post

Create `src/content/articles/<slug>.md`. The file name becomes the URL
(`/articles/<slug>.html`). Frontmatter:

```markdown
---
title: "Your Post Title"
description: "One-sentence summary for SEO and social cards."
date: 2026-06-07
keywords: "comma, separated, keywords"             # optional
ogTitle: "Optional shorter title for social cards" # optional, defaults to title
ogDescription: "Optional social description"        # optional, defaults to description
badges: ["FreeBSD", "Networking"]                  # optional
related: ["freebsd-pf-router", "why-i-run-nixos"]  # optional, other slugs
draft: false                                        # optional, hide while true
---

## Markdown body here

Regular markdown. Fenced code blocks, links, lists, and images all work.
External links automatically get `target="_blank"`.
```

That's the whole workflow. The homepage blog list, `/feed.xml`, and the sitemap
pick it up on the next build. No other files to touch. (This replaces the old
four-places-to-edit dance of `index.html` + `feed.xml` + `sitemap.xml` + the
article file.)

## Project structure

```
src/
├── components/      Nav.astro, Footer.astro
├── layouts/         BaseLayout.astro, ArticleLayout.astro
├── pages/           index.astro + one .astro per top-level page
│   ├── articles/[slug].astro   dynamic route for every article
│   └── feed.xml.js             RSS feed endpoint (/feed.xml)
├── content/articles/*.md       the blog posts
└── content.config.ts           article frontmatter schema
public/              style.css, favicon, images, robots.txt, healthy.html
scripts/             one-time HTML→markdown migration helper
```

## Customizing the theme

The design uses CSS custom properties. Edit `public/style.css` and modify the
`:root` block:

```css
:root {
  --accent-primary: #3b82f6;     /* Primary blue */
  --accent-secondary: #8b5cf6;   /* Purple accent */
  /* ...spacing, typography, and more... */
}
```

## Deploy

Cloudflare Pages, building from this repo:

- **Build command:** `bun run build`
- **Build output directory:** `dist`
- Push to the default branch deploys production; branches/PRs get preview URLs.

## Contact

- **Email**: mvivirito@gmail.com
- **LinkedIn**: [linkedin.com/in/mvivirito](https://www.linkedin.com/in/mvivirito)
- **GitHub**: [github.com/mvivirito](https://github.com/mvivirito)
- **Website**: [michaelvivirito.com](https://michaelvivirito.com)

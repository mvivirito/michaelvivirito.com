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
- Output is 100% static HTML/CSS, deployed to Cloudflare Workers Assets.
- `build.format: 'file'` emits `/page.html` files; Cloudflare serves them at
  clean URLs (`/page`). Legacy `.html` URLs still resolve.

## Develop

```sh
bun install
bun run dev        # local dev server with hot reload
bun run build      # static build into dist/
bun run preview    # serve the built dist/ locally
```

## Add a blog post

Create `src/content/articles/<slug>.md`. The file name becomes the URL
(`/articles/<slug>`). Frontmatter:

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

## Affiliate links

Some posts and the `/recommends` page contain affiliate links. The
canonical pattern, in either markdown or `.astro`:

```html
<a href="..." rel="sponsored noopener noreferrer" target="_blank">Product name</a>
```

Use inline HTML in markdown so the `rel="sponsored"` attribute survives the
build. Any page that surfaces an affiliate link should display this callout
near the top of the body so readers see it before they click:

```html
<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 1.5rem 0; font-size: 0.9rem;">
<strong>Heads-up:</strong> Some links on this page are affiliate links. Buying through them helps fund <a href="/openworld">OpenWorld</a> and the homelab. See the <a href="/disclosure">disclosure</a> for details.
</div>
```

The FTC disclosure lives at `/disclosure` and is footer-linked from every page
via `src/components/Footer.astro`. Add new products to the matching section of
`src/pages/recommends.astro` and route the affiliate URL through
`src/data/affiliates.ts` so it gets a clean `/go/<slug>/` redirect with
`rel="sponsored nofollow"`.

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

Cloudflare Workers (Assets), with the Cloudflare GitHub integration building
from this repo:

- **Build command:** `bun run build`
- **Build output directory:** `dist`
- Push to the production branch deploys production; branches/PRs get preview URLs.

## Contact

- **Email**: mvivirito@gmail.com
- **LinkedIn**: [linkedin.com/in/mvivirito](https://www.linkedin.com/in/mvivirito)
- **GitHub**: [github.com/mvivirito](https://github.com/mvivirito)
- **Website**: [michaelvivirito.com](https://michaelvivirito.com)

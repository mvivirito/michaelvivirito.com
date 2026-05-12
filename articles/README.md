# Articles Directory

All blog posts live here. Each post is one self-contained HTML file that
inherits site-wide styling from `../style.css`.

## How to Add a New Article

### 1. Copy the template

```bash
cp _template.html your-article-slug.html
```

Slug is lowercase, hyphen-separated, and matches what you want in the URL
(e.g. `freebsd-jails-network.html`, `xgs-pon-bypass-att-gateway.html`).

### 2. Fill in the EDIT markers

Open the new file and work top-down. Anything you need to change is flagged
with an `<!-- EDIT: ... -->` comment:

- **Head**: `<title>`, meta description, keywords, OG/Twitter title and
  description. Title appears in four places (title tag, og:title,
  twitter:title, h1) and they should all match.
- **Header**: `<h1>`, publication `<time datetime="YYYY-MM-DD">`, badges.
  Badge palette in the template comments matches what the rest of the site
  uses; pick three to five that fit.
- **Body**: the template ships the build/howto skeleton most posts on this
  site follow (Hook, Why, Bill of Materials, step-by-step `<h2>`s, Smoke
  Test, Common Pitfalls, Where to Go Next). Drop the sections that don't
  apply (e.g. opinion pieces don't need a Bill of Materials), don't leave
  them empty.

The bottom of the template has an authoring checklist as an HTML comment.
Delete that comment block before publishing.

### 3. Wire the new article into the site

Four places need updates whenever a new article ships:

1. `../sitemap.xml` — add a new `<url>` entry with today's `lastmod`.
2. `../feed.xml` — prepend a new `<item>` to the channel and bump
   `<lastBuildDate>` to match.
3. `../index.html` — add a row to the `blog-ls` block with today's date.
4. `../homelab.html` — add to "Articles in This Series" if the article
   belongs to the homelab series.

### 4. Commit and push

```bash
git add your-article-slug.html ../sitemap.xml ../feed.xml ../index.html
git commit -m "Add article: Your Article Title"
git push origin <branch-name>
```

AWS Amplify deploys automatically once pushed.

## Voice and Style Notes

- **No em dashes.** Use commas, colons, parentheses, or sentence breaks
  instead. Site-wide convention.
- **Lead with intent before commands.** Explain why a step matters before
  the code block, not after.
- **Inline code is `<code>`. Block code is `<pre><code>...</code></pre>`.**
  Inside a block, the first line should be a comment naming the file path
  if the snippet belongs in a specific file.
- **Internal links over external.** Cross-link to other articles on the
  site under "Where to Go Next" and "Related Posts". External links are
  fine, but the network of internal links is what makes the site feel like
  a single body of work.

## Adding Images

Drop them in `articles/pix/` and reference them with:

```html
<figure>
  <img src="pix/my-image.png" alt="Descriptive alt text">
  <figcaption>Caption for the image</figcaption>
</figure>
```

## Newsletter Form

The newsletter form at the bottom of every article is wired to
[Buttondown](https://buttondown.email/mvivirito) under the `mvivirito`
account. The same snippet ships in `_template.html`, so new articles get
it automatically. No further setup needed.

// One-time migration: converts the hand-written articles/*.html into
// Astro content-collection markdown at src/content/articles/*.md.
//
// - Frontmatter is lifted from <head> meta + the <article> <header>.
// - The single <div class="card"> body is converted to markdown via turndown.
// - Callout <div>s are kept as raw HTML to preserve their styling.
// - Repeated chrome (newsletter / related / back-to-blog) is dropped; it now
//   lives in ArticleLayout.astro. "related" slugs are captured into frontmatter.
//
// Run once:  bun scripts/convert-articles.mjs
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'articles';
const OUT = 'src/content/articles';
mkdirSync(OUT, { recursive: true });

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});
// Preserve callout boxes (and any other raw div) verbatim as HTML.
td.keep(['div']);

const yaml = (s) =>
  '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

const files = readdirSync(SRC).filter(
  (f) => f.endsWith('.html') && f !== '_template.html',
);

let count = 0;
for (const file of files) {
  const slug = file.replace(/\.html$/, '');
  const root = parse(readFileSync(join(SRC, file), 'utf8'), { comment: false });

  const meta = (sel) => root.querySelector(sel)?.getAttribute('content');
  const description = meta('meta[name="description"]');
  const keywords = meta('meta[name="keywords"]');
  const ogTitle = meta('meta[property="og:title"]');
  const ogDescription = meta('meta[property="og:description"]');

  const article = root.querySelector('article');
  const header = article.querySelector('header');
  const title = header.querySelector('h1').text.trim();
  const date = header.querySelector('time')?.getAttribute('datetime');
  const badges = header.querySelectorAll('.badge').map((b) => b.text.trim());

  // Content = direct child <div class="card"> elements of <article>.
  const cards = article.childNodes.filter(
    (n) => n.tagName === 'DIV' && (n.getAttribute('class') || '').split(/\s+/).includes('card'),
  );
  const contentHtml = cards.map((c) => c.innerHTML).join('\n');

  // Related = the <ul> inside the div whose <h3> says "Related Posts".
  let related = [];
  for (const div of article.querySelectorAll('div')) {
    const h3 = div.querySelector('h3');
    if (h3 && /related posts/i.test(h3.text)) {
      related = div
        .querySelectorAll('a')
        .map((a) => (a.getAttribute('href') || '').replace(/\.html$/, ''))
        .filter(Boolean);
      break;
    }
  }

  const body = td.turndown(contentHtml);

  const fm = ['---', `title: ${yaml(title)}`];
  if (description) fm.push(`description: ${yaml(description)}`);
  if (date) fm.push(`date: ${date}`);
  if (keywords) fm.push(`keywords: ${yaml(keywords)}`);
  if (ogTitle) fm.push(`ogTitle: ${yaml(ogTitle)}`);
  if (ogDescription) fm.push(`ogDescription: ${yaml(ogDescription)}`);
  if (badges.length) fm.push(`badges: [${badges.map(yaml).join(', ')}]`);
  if (related.length) fm.push(`related: [${related.map(yaml).join(', ')}]`);
  fm.push('---', '');

  writeFileSync(join(OUT, `${slug}.md`), fm.join('\n') + body + '\n');
  count++;
  console.log(`✓ ${slug}.md  (${badges.length} badges, ${related.length} related, date=${date})`);
}
console.log(`\nConverted ${count} articles -> ${OUT}`);

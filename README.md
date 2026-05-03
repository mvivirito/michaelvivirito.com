# michaelvivirito.com

Personal site for Michael Vivirito — Lead Site Reliability Engineer.

Topics: Kubernetes, FreeBSD, networking, AWS, and self-hosted infrastructure.

## Design

Static HTML5 + CSS3 + a sliver of vanilla JavaScript (smooth scrolling). Dark
terminal/TUI theme based on Catppuccin Mocha, monospace throughout. No frameworks,
no build step.

### Key features

- CSS custom properties for theming
- Mobile-first responsive layout
- Semantic HTML with WCAG AA contrast
- Open Graph, Twitter Card, and JSON-LD structured data
- A small template (`articles/_template.html`) for adding new posts

## Project structure

```
/
├── index.html               # Homepage: hero, about, projects, homelab, blog
├── homelab.html             # FreeBSD pf router showcase
├── now.html                 # /now page — current focus
├── contact.html             # Contact links
├── visuals.html             # Pure-CSS visual experiments
├── feed.xml                 # RSS feed
├── style.css                # Single stylesheet, CSS variables
├── articles/
│   ├── _template.html       # Boilerplate for new articles
│   ├── README.md            # Author guide
│   ├── *.html               # Published articles
│   └── pix/                 # Per-article images
├── pix/                     # Site-wide images
├── favicon.ico
├── robots.txt
└── README.md                # This file
```

## Deployment

Hosted on **AWS Amplify** with automatic deployment from the configured branch.
Push to the branch Amplify is wired to and changes go live within a couple of
minutes.

### Quick deploy

```bash
git add .
git commit -m "Your commit message"
git push -u origin <branch-name>
```

## Newsletter

The newsletter form across the site is wired to [Buttondown](https://buttondown.email).
Before it works in production, replace the placeholder username:

```bash
# Replace BUTTONDOWN_USERNAME with your actual Buttondown account name
grep -rl BUTTONDOWN_USERNAME --include="*.html" .
# Then sed/edit those files to substitute the real username
```

Until that's done, submitting the form will hit a 404 on Buttondown's API, so
either swap the username or drop the form entirely if you don't intend to run
a newsletter.

## ✍️ Adding New Articles

Creating new articles is easy with the template system:

### Quick Start

1. **Copy the template:**
   ```bash
   cd articles
   cp _template.html my-new-article.html
   ```

2. **Edit the content:**
   - Update title, meta tags, and date
   - Replace example content with your article
   - Add images to `articles/pix/` if needed

3. **Commit and push:**
   ```bash
   git add articles/my-new-article.html
   git commit -m "Add article: My New Article"
   git push -u origin <branch-name>
   ```

4. **Update the homepage:**
   - Add a link to your article in the appropriate category card in `index.html`

See `articles/README.md` for detailed instructions and examples.

## 🎨 Customizing the Theme

The design uses CSS custom properties (variables) for easy customization. Edit `style.css` and modify the `:root` section:

```css
:root {
  /* Colors */
  --accent-primary: #3b82f6;     /* Primary blue */
  --accent-secondary: #8b5cf6;   /* Purple accent */

  /* Spacing */
  --space-md: 1rem;
  --space-lg: 1.5rem;

  /* Typography */
  --font-size-base: 1rem;

  /* And many more... */
}
```

## 🛠️ Tech Stack

- **HTML5**: Semantic markup
- **CSS3**: Modern features (Grid, Flexbox, Custom Properties, Animations)
- **JavaScript**: Minimal vanilla JS (smooth scrolling only)
- **Hosting**: AWS Amplify
- **Version Control**: Git/GitHub

## 📊 Features Breakdown

### Homepage sections

1. **Hero**: Name, role, focus areas, primary CTAs
2. **About**: Bio, current focus, certifications
3. **Projects**: Featured GitHub repositories
4. **Homelab**: FreeBSD pf router showcase
5. **Blog**: Article listing in `ls -lah` style
6. **Newsletter**: Email signup
7. **Connect**: Contact and social links

### Responsive Design

- **Mobile** (< 640px): Single column, stacked layout
- **Tablet** (640px - 1024px): 2-column grid for cards
- **Desktop** (> 1024px): 3-column grid, optimized spacing

### Accessibility Features

- Semantic HTML5 elements
- ARIA labels where appropriate
- Keyboard navigation support
- High contrast text (WCAG AA)
- Focus indicators on interactive elements
- Alt text on all images

### SEO Optimization

- Descriptive meta tags
- Open Graph tags for social sharing
- Twitter Card support
- Structured data (JSON-LD)
- Semantic HTML hierarchy
- Fast load times
- Mobile-friendly design

## 📝 Content Guidelines

### Writing Articles

- Use clear, descriptive titles
- Include code examples with syntax highlighting
- Add images to illustrate concepts
- Use headings to organize content (H2, H3, H4)
- Keep paragraphs concise and scannable
- Add callout boxes for important tips

### Adding Projects

Edit `index.html` and add a new project card in the `#projects` section:

```html
<div class="card project-card">
  <h3>Project Name</h3>
  <p>Brief description of the project.</p>
  <div class="project-meta">
    <span class="project-language">
      <span class="language-dot" style="background: #f1e05a;"></span>
      JavaScript
    </span>
    <a href="https://github.com/mvivirito/project" class="project-link">
      View on GitHub →
    </a>
  </div>
</div>
```

## 🔧 Maintenance

### Regular Updates

- Update certifications and skills as you earn them
- Add new projects as you build them
- Keep articles current and relevant
- Refresh project descriptions periodically

### Performance

The site is intentionally lightweight:
- No external dependencies
- No JavaScript frameworks
- Minimal inline JS
- Optimized CSS (no bloat)
- Fast load times on all connections

## 📄 License

Personal portfolio website. All rights reserved.

## 🤝 Contact

- **Email**: mvivirito@gmail.com
- **LinkedIn**: [linkedin.com/in/mvivirito](https://www.linkedin.com/in/mvivirito)
- **GitHub**: [github.com/mvivirito](https://github.com/mvivirito)
- **Website**: [michaelvivirito.com](https://michaelvivirito.com)

---

Built with HTML, CSS, and FreeBSD enthusiasm.

# michaelvivirito.com

Modern portfolio website for Michael Vivirito - Systems Administrator & Cloud Engineer.

## 🎨 Design

A modern, responsive portfolio built with clean HTML5, CSS3, and minimal JavaScript. Features a dark theme with vibrant blue/purple accents, smooth animations, and professional typography.

### Key Features

- 🎯 **Modern Design System**: CSS custom properties for easy theming
- 📱 **Fully Responsive**: Mobile-first design that looks great on all devices
- 🚀 **Performance**: Static HTML/CSS for fast load times, no frameworks
- ♿ **Accessible**: WCAG AA compliant with proper semantic HTML
- 🔍 **SEO Optimized**: Meta tags, Open Graph, and structured data
- 🎭 **Smooth Interactions**: CSS animations and transitions
- 📝 **Easy Content Management**: Template system for adding articles

## 📁 Project Structure

```
/
├── index.html              # Main homepage with hero, about, projects, articles
├── contact.html            # Contact page with email, GPG, guidelines
├── style.css               # Complete stylesheet with CSS variables
├── articles/
│   ├── _template.html     # Template for creating new articles
│   ├── README.md          # Guide for adding articles
│   └── pix/               # Article images and assets
├── pix/                   # Main images and assets
│   ├── portrait.jpg       # Profile photo
│   ├── btc.svg            # Bitcoin icon
│   └── home.svg           # Home icon
├── favicon.ico            # Site favicon
├── robots.txt             # SEO crawling rules
└── README.md              # This file
```

## 🚀 Deployment

This site is hosted on **AWS Amplify** with automatic deployment:

1. Push changes to the branch: `claude/plan-session-wPKbe`
2. AWS Amplify automatically builds and deploys
3. Changes go live within minutes

### Quick Deploy

```bash
git add .
git commit -m "Your commit message"
git push -u origin claude/plan-session-wPKbe
```

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
   git push -u origin claude/plan-session-wPKbe
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

### Homepage Sections

1. **Hero**: Eye-catching introduction with CTA buttons
2. **About**: Bio, certifications, professional background
3. **Projects**: Featured GitHub repositories with live links
4. **Articles**: Topic-organized article categories
5. **Connect**: Social links and Bitcoin donation
6. **Footer**: Navigation and copyright

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

Built with HTML, CSS, and passion. ✨

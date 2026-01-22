# Articles Directory

This directory contains all blog posts and articles for the portfolio website.

## How to Add a New Article

Adding a new article is simple! Just follow these 3 steps:

### Step 1: Copy the Template

```bash
cp _template.html your-article-name.html
```

Choose a descriptive filename using lowercase and hyphens (e.g., `setting-up-aws-lambda.html`, `vim-tips-tricks.html`).

### Step 2: Edit the Content

Open your new file and look for sections marked with `<!-- EDIT THIS: ... -->` comments:

1. **In the `<head>` section:**
   - Update the `<title>` tag
   - Update the meta description
   - Update keywords
   - Update Open Graph tags

2. **In the article header:**
   - Replace "Your Article Title Here" with your actual title
   - Update the publication date
   - Customize the category badges (Tutorial, Linux, AWS, etc.)

3. **In the article body:**
   - Replace the example content between the `<!-- EDIT BELOW -->` and `<!-- EDIT ABOVE -->` comments
   - Write your article using the provided HTML structure

### Step 3: Commit and Push

```bash
git add your-article-name.html
git commit -m "Add article: Your Article Title"
git push origin claude/plan-session-wPKbe
```

AWS Amplify will automatically deploy your changes!

## Available HTML Elements

The template includes examples of:

- **Headings**: `<h2>`, `<h3>`, `<h4>`
- **Paragraphs**: `<p>`
- **Code blocks**: `<pre><code>...</code></pre>`
- **Inline code**: `<code>...</code>`
- **Lists**: `<ul>`, `<ol>`
- **Images**: `<figure>`, `<img>`, `<figcaption>`
- **Emphasis**: `<strong>`, `<em>`
- **Callout boxes**: Styled `<div>` elements

## Adding Images

1. Place your images in the `articles/pix/` directory
2. Reference them in your article:

```html
<figure>
  <img src="pix/my-image.png" alt="Descriptive alt text">
  <figcaption>Caption for the image</figcaption>
</figure>
```

## Styling Tips

All styling is automatically inherited from the main `style.css` file. The template uses:

- Responsive grid layouts
- Card components for clean presentation
- Syntax-highlighted code blocks
- Professional typography
- Consistent spacing and colors

## Example Article Structure

```html
<h2>Introduction</h2>
<p>Opening paragraph...</p>

<h2>Main Topic</h2>
<p>Detailed explanation...</p>

<h3>Subtopic</h3>
<p>More specific details...</p>

<pre><code>
# Code example
echo "Hello, World!"
</code></pre>

<h2>Conclusion</h2>
<p>Wrap up...</p>
```

## Need Help?

The template file (`_template.html`) contains extensive comments and examples. Just follow the structure and replace the placeholder content with your own!

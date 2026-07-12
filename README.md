# RetireWise — Federal Retirement Planning Blog

A content-driven blog and calculator platform focused on **federal employee retirement planning**. Built with Astro and deployed via a fully automated CI/CD pipeline to GitHub Pages.

## About

This project helps federal employees navigate the complexities of retirement — covering FERS, TSP, CSRS, Social Security coordination, survivor benefits, and more. It pairs in-depth articles with sophisticated planning calculators.

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Framework | [Astro 7](https://astro.build) |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Fonts | Playfair Display, Inter, JetBrains Mono (self-hosted) |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages |

## CI/CD Pipeline

Every push to `main` automatically:
1. Installs dependencies
2. Builds the static site via `astro build`
3. Deploys to GitHub Pages

Live site: **https://matanov.github.io/finportal/**

## Project Structure

```text
/
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions CI/CD
├── public/
├── src/
│   ├── components/
│   ├── layouts/
│   ├── pages/
│   └── styles/
│       └── global.css       # Tailwind v4 brand design tokens
└── astro.config.mjs
```

## Local Development

```sh
npm install        # Install dependencies
npm run dev        # Start dev server at localhost:4321
npm run build      # Build for production
npm run preview    # Preview production build locally
```

## Deployment

Deployment is fully automated. To publish a change:

```sh
git add -A
git commit -m "your message"
git push
```

The GitHub Actions workflow handles the rest.

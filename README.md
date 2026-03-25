# Image Canvas App

[![CI](https://github.com/lx-0/image-canvas-app/actions/workflows/ci.yml/badge.svg)](https://github.com/lx-0/image-canvas-app/actions/workflows/ci.yml)

Upload images to an interactive HTML5 canvas with drawing tools, filters, AI-powered analysis, and gallery management.

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the production server |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:e2e` | Run E2E tests (Playwright) |
| `npm run lint` | Run ESLint |

## Docker

```bash
docker compose up --build
```

## CI/CD

The GitHub Actions pipeline runs on every push and PR to `main`:

1. **Lint** - ESLint checks
2. **Unit Tests** - Vitest suite
3. **Docker Build** - Multi-stage container build
4. **E2E Tests** - Playwright tests against the Docker container
5. **Deploy** - Push to GitHub Container Registry (main branch only)

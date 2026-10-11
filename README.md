# Portfolio

A personal portfolio with a browser-only Japanese image-to-text tool. The site
showcases the application itself alongside the technologies used to build, test,
and deploy it.

## What It Includes

- A React frontend with project listings and build information.
- Japanese OCR powered by Tesseract.js and WebAssembly, with manual text boxes,
  confidence-aware region selection, mask-based text removal, preprocessing
  alternatives for difficult backgrounds, and glossary corrections. Image
  processing happens locally in the browser; images are not uploaded.
- A small Node.js/Fastify API for project data and build metadata.
- Automated tests and GitHub Actions checks, plus GitHub Pages deployment with
  static snapshots of the API responses.
- Docker Compose for running the frontend and API together, with nginx serving
  the built frontend and proxying API requests.

## Project Layout

- `apps/web`: React/Vite frontend and OCR processing.
- `apps/api`: Fastify API.
- `.github/workflows`: checks and GitHub Pages deployment.

For local setup and test commands, see [the web app README](apps/web/README.md).
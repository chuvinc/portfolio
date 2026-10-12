# Portfolio

A personal portfolio with a browser-based image text reader. The site showcases
the application itself alongside the technologies used to build, test, and deploy it.

## What It Includes

- A React frontend with project listings and build information.
- OCR powered by Tesseract.js and WebAssembly, with manual text boxes,
  confidence-aware region selection, mask-based text removal, preprocessing
  alternatives for difficult backgrounds, glossary corrections, and per-region
  replacement lettering. Add centered text using the bundled CC Wild Words font,
  adjust its alignment, weight, outline, size, color, and box dimensions, then
  export the cleaned page with lettering as a PNG. OCR runs in the browser; the
  selected image remains in the page while the tool is in use and can be removed
  with Clear Image.
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
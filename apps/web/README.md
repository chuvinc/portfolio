# Portfolio Web App

React and Vite frontend for the portfolio and browser-only Japanese OCR tool.
The API supplies project listings and build information. OCR images stay in the
browser; generated worker, WebAssembly core, and Japanese models are self-hosted.

## Development

From the repository root:

```sh
npm ci
npm run install:all
npm run dev
```

Vite prints the web URL and proxies `/api` to the Node API on port 3000.
To run only the frontend, use `npm run dev --prefix apps/web`.
On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm`.

## Checks

From the repository root:

```sh
npm test
npm run lint
npm run build
```

Development and production builds copy OCR assets into `public/ocr` using
`scripts/copy-ocr-assets.mjs`. Do not edit those generated assets.

## OCR

Upload or paste an image, then draw boxes manually or detect candidate regions.
Read enabled boxes; Thorough read offers preprocessing alternatives for difficult
text. Glossary corrections apply to extracted output. Engine confidence is not
a guarantee of character accuracy.

The React Compiler is not enabled. Tests use Vitest and React Testing Library.

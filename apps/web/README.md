# Portfolio Web App

React and Vite frontend for the portfolio and browser-based image text reader.
The API supplies project listings and build information. OCR runs in the browser
using the self-hosted worker, WebAssembly core, and language data. The selected
image remains in the page while you work and can be removed with Clear Image.

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

Upload or paste an image, then detect text regions or draw boxes manually. Click
boxes to include or exclude them: red is off, green is included, and orange marks
an unsure reading. `Read (x)` reads the included boxes that have not been read yet;
`x` is their count. `Read All` includes and reads every box. Ctrl-click selects
boxes for bulk actions.

The `More` menu contains text removal, mask reset, detection again, original or
cleaned image switching, cleaned-image download, and clearing the image. For
whole-image OCR, use `Extract text` in `More`. Thorough read offers preprocessing
alternatives for difficult text, and glossary corrections apply to extracted
output. Engine confidence is not a guarantee of character accuracy.

After removing text, each included region has its own replacement-text layer.
Read the boxes first to prefill their OCR results, then select a region by
clicking its box on the cleaned image or choosing it in the `Box` control. Edit
its text, position, width, height, alignment, weight, color, and optional
opposite-color outline. `Download` exports the cleaned image with all replacement
text as a PNG, using the bundled CC Wild Words font.

The React Compiler is not enabled. Tests use Vitest and React Testing Library.

# Portfolio Web App

React and Vite frontend for the portfolio and Image Text Studio, a browser-based
OCR, image cleanup, and lettering tool. The API supplies project listings and
build information. OCR runs in the browser
using the self-hosted worker, WebAssembly core, and language data. The selected
image remains in the page while you work and can be removed with Clear Image.

## Development

Use Node.js 22.12 or newer and npm.

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

## Image Text Studio

### Reading And Removing Original Text

Leave `Clean image (text boxes only)` unchecked, then upload or drop an image.
For whole-image OCR, choose a text layout and use `More` > `Extract text`.
For region-based reading and cleanup:

1. Set `Text layout` to `Find text regions (mixed pages)` and choose
	`More` > `Detect Again`, or drag on the original image to draw regions manually.
2. Click regions to include or exclude them. Red is off, green is included, and
	orange marks an unsure reading. Detected regions start off. `All On` includes
	every region without reading it; Ctrl/Cmd-click selects regions for bulk actions.
3. Optionally use `Read (x)` to read included regions that have not been read yet.
	`Read All` turns every region on and reads those without a result. Reading
	before cleanup prefills replacement text; it is not required for text removal.
4. Choose `Show Mask` to create and inspect the cleanup mask. Use `Erase Mask`
	and `Mask brush size` to exclude areas from cleanup. Selected regions can also
	use solid fills, with a chosen color or a color sampled from the original image.
5. Choose `More` > `Remove Text` to generate the cleaned background. To remove
	all original text, include every original text region in the mask, drawing
	additional regions where detection missed text.

After changing which regions are included, use `More` > `Reset Mask` to rebuild
the mask. This discards manual mask erasures. Rerun `Remove Text` after changing
the mask or solid fills to update the cleaned background and its exports.
Use `Show Original` to return to region editing and `Show Cleaned` to view lettering.

Thorough read offers preprocessing alternatives for difficult text, and glossary
corrections apply to extracted output. Engine confidence is not a guarantee of
character accuracy. `Copy text` copies the extracted result; clipboard image
importing is not supported.

### Lettering And Downloads

After cleanup, each included region has its own replacement-text layer. Select
a region on the cleaned image or in the `Box` control, then edit its text. Use
`More` > `Add text box` for additional lettering. Drag text boxes to move them,
and drag the active box's resize handle or use the width and height sliders to
resize them. Alignment, bold weight, size, color, and an opposite-color outline
are adjustable. All text layers use the bundled CC Wild Words font.

The `More` menu offers:

- `Download with text`: exports the cleaned background with the current lettering
  as `manga-lettered.png`.
- `Download Textless`: exports the background from the last `Remove Text`
  operation without text layers as `manga-cleaned.png`.

### Already-Clean Images

Enable `Clean image (text boxes only)` before uploading or dropping the file.
Use `More` > `Add text box` to add lettering without OCR or cleanup. The same
text, movement, resizing, and style controls are available; `Delete text box`
removes the selected manually added box. This mode hides OCR settings and the
glossary, and offers only `Download with text`, not `Download Textless`.

The import option applies to the next image you load, not the current image.
`Clear Image` removes the current image and text boxes. Uncheck the clean-image
option before loading an image that needs OCR or text removal.

The React Compiler is not enabled. Tests use Vitest and React Testing Library.

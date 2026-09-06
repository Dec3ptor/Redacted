# Blackout

A static site for redacting documents properly. A black box drawn over text in
Preview, Word, or Acrobat only covers the words — they are still selectable in
the file. Blackout rasterises each page and paints the boxes into the pixels, so
the text underneath is destroyed rather than hidden.

Everything runs in the browser. No file is ever uploaded.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | The redaction tool — load a PDF or image, draw boxes, save a flattened copy |
| `metadata.html` | Inspect and strip EXIF / document metadata |
| `how-it-works.html` | Why flattening works and what it costs |
| `history.html` | Real cases where a black box failed |

`style.css` is shared by all four. Links between pages are relative, so the site
works from any base path.

## Running locally

No build step. Serve the directory over HTTP (opening `index.html` from the
filesystem breaks the PDF worker):

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deployment

`.github/workflows/pages.yml` publishes the repository root to GitHub Pages on
every push to `main`, and can also be run manually from the Actions tab.

One-time setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.
The site then serves at `https://dec3ptor.github.io/Redacted/`.

`.nojekyll` is present so Pages serves the files as-is instead of running them
through Jekyll.

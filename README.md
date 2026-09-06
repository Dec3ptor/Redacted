# Blackout

A static site for redacting documents properly. A black box drawn over text in
Preview, Word, or Acrobat only covers the words — they are still selectable in
the file. Blackout rasterises each page and paints the boxes into the pixels, so
the text underneath is destroyed rather than hidden.

Everything runs in the browser. No file is ever uploaded.

## Marking things up

Four ways to cover something, all on the redaction page:

- **Draw** a box freehand over any part of the page.
- **Select text** the way you would in any document; letting go blacks it out.
- **Search** for a phrase and box every instance of it at once.
- **Smart scan** for common sensitive patterns — email addresses, payment cards
  (Luhn-checked), IBANs, social security numbers, IP addresses, coordinate
  pairs, dates and phone numbers.

Smart scan only sees the document's text layer. A scanned page has no text
layer, so it finds nothing there — that is not a clean bill of health, and names
and addresses always need reading by eye. Every box it adds is reviewable,
movable and undoable before you save.

## The two output modes

**Permanent** flattens each page to a picture and paints the boxes into it. The
covered words are gone, and so is the rest of the text layer, the metadata and
any annotations.

**Reversible** produces the same flattened page, but embeds the exact original
file inside it as an AES-256-GCM encrypted recovery payload that only the
recovery key opens. Worth being clear about the tradeoff: the original travels
inside the file you send. Anyone holding both the file and the key gets
everything back, so a reversible file is not the thing to hand to the person you
are redacting against. Use permanent mode for that.

Saving runs through the metadata page — redact, then review and strip metadata,
then save the finished file.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | The redaction tool |
| `metadata.html` | Inspect and strip EXIF / document metadata, and finalise a redacted file |
| `how-it-works.html` | Why flattening works and what it costs |
| `history.html` | Real cases where a black box failed |

| Script | What it does |
| --- | --- |
| `app.js` | The redaction tool: rendering, text layer, search, smart scan, export |
| `blackout-core.js` | Recovery crypto, PNG/PDF recovery containers, watermark, local handoff |
| `metadata.js` | Metadata inspection and removal |
| `brand-config.js` | Product name, website and watermark toggle |

`style.css` is shared by every page. Links between pages are relative, so the
site works from any base path.

## Running locally

No build step. Serve the directory over HTTP (opening `index.html` from the
filesystem breaks the PDF worker):

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deployment

`.github/workflows/pages.yml` publishes the repository root to GitHub Pages on
every push to `main`, and can also be run manually from the Actions tab. Pages
is configured with **Source: GitHub Actions**, and the site serves at
<https://dec3ptor.github.io/Redacted/>.

`.nojekyll` is present so Pages serves the files as-is instead of running them
through Jekyll.

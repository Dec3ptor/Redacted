# Blackout v3 — reversible redaction + metadata flow + branding

This package replaces/adds files on the working branch `claude/site-git-pages-hosting-zmtd6i`.

## What changed

### 1. Reversible redaction is now file-format agnostic
Reversible mode no longer stores only original image pixels. It encrypts the **exact original source file bytes**.

That means a blackout can cover:
- PDF text
- photos embedded in PDFs
- diagrams and vector artwork
- scanned pages
- ordinary image pixels
- any other visible page content

The redacted output remains visually flattened. With the correct recovery key, Blackout can reveal or export the exact original file.

### 2. Post-quantum-resilient shared-key design
The recommended recovery key is generated as `BO2-...` and contains 256 random bits.

Recovery v2 uses:
- AES-256-GCM authenticated encryption
- 96-bit random IV per payload
- exact-file encryption (not a reconstruction recipe)
- versioned / crypto-agile recovery envelope
- direct raw 256-bit AES key for generated `BO2-...` recovery keys
- PBKDF2-HMAC-SHA-256 at 600,000 iterations only for manually-entered passphrases

A high-entropy generated recovery key is strongly preferred over a memorable passphrase.

The shared-key design intentionally does **not** depend on RSA or elliptic-curve cryptography. If Blackout later adds recipient public keys, ML-KEM can be added as a key-wrapping/recipient mechanism without changing the encrypted file payload format.

### 3. Reversible PDFs
PDFs can now be created in reversible mode too.

The visible PDF is flattened/redacted. The encrypted Blackout recovery stream contains the original PDF bytes. The metadata cleaner recognises this stream as protected Blackout recovery data and does not remove it.

### 4. Redact → metadata → final save
The redaction page no longer saves immediately.

Workflow:
1. redact the PDF/image
2. choose Permanent or Reversible
3. click **Continue to metadata**
4. the intermediate file is passed locally through IndexedDB
5. inspect/remove metadata
6. Blackout applies the final brand mark
7. save the finished file

The handoff stays local in the browser and survives a metadata-page refresh until final save.

### 5. Final brand mark
Every redacted PDF page or redacted image receives a bottom-right mark during finalisation:

`[black bar] Redacted with Blackout`

with the configured website underneath.

Set the future website once in `brand-config.js`:

```js
window.BLACKOUT_CONFIG = Object.assign({
  productName: 'Blackout',
  website: 'your-domain.example',
  watermarkEnabled: true
}, window.BLACKOUT_CONFIG || {});
```

`watermarkEnabled` is deliberately centralised so a future paid plan can disable branding without rewriting export logic.

### 6. Protected recovery vs removable metadata
For reversible files, metadata removal preserves the Blackout encrypted recovery payload by design. Everything else remains eligible for the normal cleaning rules.

The encrypted payload can contain the exact original file, including original metadata. That information is ciphertext and cannot be read without the recovery key.

## Important limitations
- Do not call any cryptography literally “quantum proof.” The accurate claim is **post-quantum resilient** based on current cryptanalysis and standards.
- A generated 256-bit recovery key is much stronger than a human-created password.
- Reversible files are larger because they contain the encrypted original.
- Third-party PDF optimisers or image recompressors may discard Blackout-specific recovery data. Share the exported file itself rather than a screenshot/recompressed derivative.
- The visible branding mark is not DRM; a determined user can crop or edit it. It is product attribution for the normal workflow.

## New files
- `brand-config.js` — product/domain/watermark configuration
- `blackout-core.js` — recovery crypto, PNG/PDF recovery containers, watermark rendering, local handoff

## Updated files
- `index.html`
- `app.js`
- `app.css`
- `metadata.html`
- `metadata.js`
- `metadata.css`

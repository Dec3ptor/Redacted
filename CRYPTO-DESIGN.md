# Blackout Recovery v2 cryptographic design

## Goal
A recipient without the recovery key sees only the flattened redacted derivative. A recipient with the key can recover the exact original file.

## Recommended key mode
Blackout generates a 32-byte cryptographically random secret and serialises it as a `BO2-...` recovery key. This key is used directly as the AES-256 key.

No RSA or elliptic-curve key exchange is involved in the shared-key workflow.

## Encryption envelope
Outer header (not secret):
- magic/version
- cipher suite
- key-derivation mode
- salt (when relevant)
- IV

Authenticated encrypted plaintext:
- original filename/type and recovery metadata
- redaction geometry manifest
- exact original source-file bytes

The outer header is supplied as AES-GCM additional authenticated data, so tampering with algorithm parameters causes decryption failure.

## Algorithms
Primary generated-key mode:
- AES-256-GCM
- random 96-bit IV
- 256-bit random shared key

Manual passphrase compatibility mode:
- PBKDF2-HMAC-SHA-256
- 600,000 iterations
- random 128-bit salt
- AES-256-GCM

The UI recommends generated keys because password entropy, not cipher strength, is normally the weakest point of a passphrase-based encrypted file.

## Crypto agility
The envelope is explicitly versioned (`BLACKOUT-R2`). A future format can add a different symmetric cipher, KDF, or post-quantum recipient key-wrapping mechanism without trying to reinterpret old files.

The PBKDF2 iteration count is read back from the header rather than hardcoded at decryption, so raising it later does not strand existing files. Reading it from the header is safe because the header is the GCM additional authenticated data: a tampered count changes the derived key and fails the tag. Bounds on the parsed value only stop a malformed file from requesting absurd work.

## Container
The recovery payload is carried in a PDF catalog stream (`BlackoutRecovery`) or a PNG ancillary chunk. The PNG chunk type is `boRv`: ancillary, private, reserved bit clear, safe to copy. An earlier build used `boR2`, whose trailing digit is not a letter and is therefore malformed under the PNG specification; that type is still read so older files continue to open, and is stripped alongside the current one.

If public-key recipient sharing is added later, use a standard post-quantum KEM such as ML-KEM to wrap a random content-encryption key. Keep bulk file encryption symmetric.

## Making a reversible file permanent
`unlock.html` can strip the recovery block from a file, leaving the flattened
redaction with nothing left to reverse. This is the intended way to take a file
that was reversible inside your own boundary and release it outside one.

Removal deletes the payload object itself, not just the reference to it.
Deleting only the catalog entry leaves an orphaned stream that still holds the
ciphertext, so the key would still open a file that claimed to be permanent.
After rewriting, the saved bytes are scanned for the `BOR2` envelope magic and
the save is abandoned if any is found — the check reads the file, not the
reference, because following the reference is what produced the false pass.

## Visible mark
A reversible file is marked as one — a `REVERSIBLE` chip sits under the
wordmark, and the mark carries a link annotation to the unlock page. A permanent
file shows the wordmark alone, linking to the app. The address is deliberately
not drawn: the whole mark is the click target, so printing the URL would only
add clutter to someone else's document.

A PNG cannot carry a link, so a reversible image shows the chip but offers no
route back to the unlock page from the file itself. Whoever holds the key has to
know where to go.

Because the two variants say different things, making a file permanent has to
remove the old mark rather than cover it. In a PDF the mark is drawn into a
content stream of its own, referenced from the page under a private key, and
that stream is deleted outright when the file is made permanent — the old text
leaves the file rather than hiding under a white rectangle. Covering text with
a box instead of removing it is the failure this whole tool exists to prevent,
and that applies to our own branding as much as to a user's secrets.

An image mark is different in kind: it lives in the pixels of a flattened
raster, with no layer beneath it, so repainting that region genuinely destroys
what was there. Making a reversible image permanent therefore strips the chunk
and repaints the mark. The same move on a PDF would only hide text, which is
why the two paths differ.

## Storage of the key
The key is never written to disk by any page. The editor keeps an edit session
in IndexedDB so redaction can resume after the metadata step, and deliberately
omits the key from it — storing the key beside the ciphertext would undo the
encryption for anyone with access to the browser profile.

## Known limitations
- A lost key is unrecoverable. There is no reset and no back door; that is what
  makes the encrypted block safe to ship inside a document.
- The envelope size reveals the approximate size of the original.
- The file carries the original wherever it goes. Anyone holding both the file
  and the key has everything, and a file already sent cannot be recalled.
- Third-party PDF optimisers and image recompressors may discard the recovery
  data. Share the exported file itself, not a re-encoded derivative.

## Two redaction methods
Blackout offers both approaches, and reversible recovery works with either —
the encrypted payload holds the exact original source file, which is unrelated
to how the visible output was produced.

**Flatten to images.** Every page is rendered to pixels, the marks are painted
into those pixels, and a new file is built from the results. No text object
survives anywhere, so there is nothing to recover under a mark or outside one.
Blunt, and hard to get wrong.

**Remove the content.** Whatever sits under a mark is destroyed at source and
everything else is left untouched, so the output stays real searchable text and
real images everywhere that was not redacted. This is the method professional
tools use, and the one that fails without looking like it has: the mark is
drawn either way, so a file that kept a word is indistinguishable from one that
did not.

Nothing is refused and no page is quietly flattened when the method meets
something awkward, because those are the same act — giving the problem back to
the person who asked for a redaction. Each kind of content under a mark is
handled on its own terms:

- **Text** — the glyphs are cut out of the show operator (`Tj`, `TJ`, `'`, `"`,
  literal or hex) and the text that follows is pulled back so the line does not
  shift.
- **Images** — the image is decoded through the PDF reader, whatever its
  original format, the covered pixels are destroyed in the decoded bitmap, and
  the result is re-embedded as a fresh object. The mark is mapped into pixel
  space by inverting the image's own placement matrix, so only the covered part
  of the picture is lost. The original object is then deleted along with its
  now-dead resource entry, so the un-redacted bytes are not left orphaned in
  the file — the same failure `stripPdfRecovery` had to be fixed for.
- **Form XObjects** — walked into and edited by the same rules, under the
  matrix composed from the outside in, so nested content is handled at whatever
  depth it appears.
- **Inline images** (`BI`/`ID`/`EI`) — replaced by a redacted image object
  drawn in their place.

Nothing this method produces is offered until it has been read back and proved.
The output is re-parsed and every surviving character is placed; if any
non-space character still sits inside a mark, the file is not saved and the
reason is shown. The remaining refusals are all of the form "this file could not
be read or written at all", never "this content is inconvenient".

Two things a page can do that a simpler reading would get wrong are handled
explicitly, because both fail the same dangerous way. A page can carry
`/Rotate`, and text can carry its own matrix, so a line may be set sideways or
upside down. Marks arrive as fractions of the page *as displayed*; content
lives in the page's own space and runs along their own direction. Both the edit
and the proof map between those spaces through one shared piece of code, for a
specific reason: if each did its own arithmetic and both were wrong the same
way, the proof would agree with the mistake and pass a file that still held the
words. The editor's own boxes — search, smart scan and text selection — are
built along the run direction for the same reason, so a mark is never drawn
beside the glyphs it claims to cover.

Pairing each drawing operator with the run the reader reports for it is the
part that took the most getting right, and every mistake in it failed the same
way in both directions at once — text under a mark surviving, and text nobody
marked being cut. Counting was the original mistake: the Nth operator was given
the Nth run. Those two lists are not the same length in a real document. The
reader emits end-of-line entries with no operator behind them, splits one
operator's run into pieces where it sees a wide gap, and reports a page's runs
in an order of its own. A twenty-four page offer letter disagreed by eight on
its first page alone. Operators are therefore matched to runs by position: the
text matrix says where each one starts, the run is the one the reader puts
there, each run is claimed once, and the byte count — the only exact number
available — decides where a split run ends. The tolerance is tight across the
line and generous along it, because a run beginning with spaces is reported
from its first visible glyph and so starts ahead of the point the matrix names,
never behind it.

Two smaller faults in the same file are worth recording because neither was
visible in the result. `TextDecoder('latin1')` is an alias for windows-1252,
not ISO-8859-1: reading a content stream through it and writing the bytes back
rewrote everything in 0x80-0x9F, so a byte meaning a curly quote came back as a
control code. The page still looked right; its text did not. And the spacing
adjustment that holds a line together after a cut was derived from the font
size alone, which is only the conversion to text space if nothing else scales
the run — a document authored at ten times size was shifted ten times too far.
The run's own transform carries the whole chain and is used instead.

Neither of those would have been caught by asking only whether the marked text
was gone, which is why the proof now has a second half: the result is also
counted against the original, and every character outside the marks actually
painted has to still be there. A file that loses something it was not asked to
lose is refused exactly like one that keeps something it was.

One approximation is worth stating. A run's total width is known exactly, but
the widths of the individual glyphs inside it are not, so character positions
within a run are estimated by spreading them evenly across it. On a
proportional face that drifts — around 10pt across a line of Times — which is
too loose to decide what to delete. The cut is therefore deliberately generous,
a character wider at each end than the estimate calls for, and the mark is then
grown to cover whatever was actually taken. Two properties hold together as a
result: everything under a mark is gone from the file, and everything gone from
the file is under a mark. The cost is that a neighbouring character is
sometimes taken as well, which is the safe direction and stays invisible
because the mark grows with it.

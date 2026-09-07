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
The mark drawn on an exported file reads the same whether or not the file is
reversible; only the link annotation behind it differs, pointing at the unlock
page for a reversible file and the app for a permanent one. Keeping the drawn
text identical means making a file permanent only has to rewrite an annotation.
Nothing is ever painted over: covering text with a box instead of removing it
is the failure this whole tool exists to prevent, and that applies to our own
branding as much as to a user's secrets.

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

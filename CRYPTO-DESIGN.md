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

If public-key recipient sharing is added later, use a standard post-quantum KEM such as ML-KEM to wrap a random content-encryption key. Keep bulk file encryption symmetric.

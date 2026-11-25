# Inkly security architecture — implementation design

Status: design for review and staged implementation  
Target: static, single-user web application hosted on GitHub Pages  
Current legacy store: `localStorage["inkly_v1"]`

## 1. Security objectives

- Keep the library on the user's device; do not add an application backend or cloud sync.
- Encrypt the complete persisted library, including notes, opinions, quotes, profile fields, settings, cached recommendations, and cover metadata.
- Support optional password locking and a separate recovery key.
- Support ordinary JSON export and password-protected encrypted export.
- Preserve recovery paths and never silently replace unreadable legacy data.
- Keep cryptographic secrets and plaintext library content out of network requests, logs, and analytics.

## 2. Threat model and limitations

The design protects stored data when the browser profile's application storage is copied or inspected while the application is locked, provided the attacker does not also possess the password or recovery key.

It does not protect against:
- malicious JavaScript served from the same application origin;
- a compromised browser, operating system, or device;
- an attacker using the application while it is already unlocked;
- screenshots, clipboard capture, keyloggers, or other endpoint compromise;
- loss of both the password and recovery key.

GitHub Pages serves the application code but must never receive the user's library, password, data-encryption key, or recovery key. A malicious update to the hosted JavaScript could still read data after unlock; static hosting is not a trusted key-management boundary.

## 3. Storage and migration

### Target storage

Use IndexedDB for the encrypted library envelope and key metadata. Keep the application state model in memory so existing rendering and editing functions can be migrated incrementally.

The encrypted payload should be versioned and self-describing:
- format identifier and schema version;
- cipher and KDF identifiers;
- random salt and IV/nonce;
- KDF parameters;
- encrypted payload;
- authentication tag as provided by AES-GCM.

Do not store plaintext library fields alongside the ciphertext.

### Non-destructive migration

1. Read the exact legacy `inkly_v1` value without changing it.
2. Offer a raw JSON export and a normal readable backup before migration.
3. Parse and validate the legacy value; preserve unknown fields.
4. Create a new IndexedDB database/store without deleting the old key.
5. Encrypt and write the complete state to the new store.
6. Read it back, decrypt it, and compare the full serialized payload (or a cryptographic digest) with the source snapshot.
7. Only after successful verification, mark the encrypted store as active.
8. Retain the legacy copy through at least one verified restart and one successful user-created backup. Do not auto-delete it as part of the first migration.

Migration must be resumable or safely restartable after tab closure, browser crash, quota errors, or interrupted writes.

## 4. Key hierarchy

Use a random 256-bit Data Encryption Key (DEK) to encrypt the library with AES-256-GCM. The DEK is never derived directly from a password.

When password lock is enabled:
- derive a Key Encryption Key (KEK) from the password using a password KDF and a fresh random salt;
- use the KEK to wrap/encrypt the DEK with authenticated encryption;
- store only the wrapped DEK, salt, KDF identifier, and parameters;
- never store the password or a reusable plaintext password hash.

Recovery:
- generate a separate high-entropy random recovery secret;
- use it as an independent wrapping credential for the same DEK;
- show it once with an explicit instruction to save it outside the device;
- verify it before finalizing setup;
- never transmit it or store it in plaintext.

When password lock is disabled, the DEK still encrypts the library. The browser may retain a non-extractable CryptoKey in IndexedDB for local convenience. This mode protects against casual inspection of the stored library but does not provide the same protection as a password-locked key: same-origin malicious code may still use the available key.

## 5. Cryptographic choices

- Data encryption: AES-256-GCM with a fresh, unique 96-bit IV for every encryption under a given key. Never reuse an IV with the same key.
- Randomness: `crypto.getRandomValues`.
- Password KDF: prefer Argon2id from a pinned, reviewed, locally bundled implementation if it can be integrated without remote runtime dependencies and benchmarked on supported mobile browsers.
- Native fallback: PBKDF2-HMAC-SHA-256 through Web Crypto, with at least 600,000 iterations as a baseline reference, subject to device benchmarking and format-versioned parameters.
- Store KDF parameters with each wrapped key so they can be upgraded on later successful unlocks.
- Never use a fast hash such as plain SHA-256 as a password KDF.

OWASP guidance: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html  
OWASP cryptographic storage guidance: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

## 6. Encrypted backup format

Encrypted backup must be independent from the app's local lock state.

- Ask for a backup passphrase at export; do not reuse the application password automatically.
- Derive a backup key with a fresh salt and the KDF parameters embedded in the backup.
- Encrypt the full state snapshot with AES-256-GCM and a fresh IV.
- Authenticate the format/version metadata as additional authenticated data where supported by the implementation.
- Import must validate size, format, version, algorithm identifiers, and bounded KDF parameters before expensive derivation.
- Wrong password, tampering, truncation, or malformed data must fail before the live library is changed.
- Keep the existing library intact until decryption, parsing, schema validation, and a separate pre-import backup have all succeeded.

Ordinary JSON backups remain supported but must be clearly labelled as unencrypted.

## 7. Application lock

- Optional password gate at startup.
- Five-minute inactivity timeout, reset only by meaningful user interaction.
- Lock on page visibility loss only if explicitly chosen later; background-tab behavior varies by browser and may create false locks.
- Clear decrypted in-memory state and sensitive temporary buffers on lock as far as JavaScript permits. This is best-effort; JavaScript cannot guarantee memory zeroization.
- Avoid exposing secrets in DOM attributes, URL parameters, browser history, console output, or error messages.

## 8. Implementation gates

Do not begin destructive migration or activate encryption until all of the following are ready:
- a complete legacy backup has been created and independently verified;
- the new IndexedDB schema and migration are tested with empty, typical, and large libraries;
- key wrapping and recovery flows pass positive and negative tests;
- encrypted backup round-trips correctly and rejects wrong passwords/tampered files;
- quota errors, interrupted transactions, reloads, and mobile browser behavior are tested;
- the application has no unintended network transmission of library data or key material.

## 9. Current implementation status

Implemented on the draft branch:
- startup protection against silently replacing unreadable legacy storage;
- versioned ordinary JSON backup export;
- backward-compatible import for legacy JSON;
- structural validation, size/count bounds, confirmation, pre-import backup, and rollback attempt on failed persistence.

Not implemented yet:
- connection of the isolated IndexedDB adapter to application startup/save operations and non-destructive migration;
- activation of encryption in the application (the isolated crypto primitives now exist, but app data is not yet encrypted);
- password lock and inactivity timeout;
- recovery-key setup UI, display confirmation, safe storage guidance, and end-to-end recovery flow;
- encrypted backup export/import;
- browser end-to-end tests.

### Isolated cryptographic primitives added
The draft branch now includes a same-origin Web Crypto module and an isolated IndexedDB adapter. It implements AES-256-GCM encryption and a 256-bit random DEK. If the user chooses a password, the DEK is wrapped with PBKDF2-HMAC-SHA-256 (600,000 iterations); if the user declines the optional app password, it is wrapped by a non-extractable device CryptoKey intended for separate IndexedDB storage. A 256-bit random recovery code independently wraps the DEK in either mode. The adapter stores the encrypted envelope and optional device CryptoKey atomically in a single IndexedDB record. Both modules are unit-tested with a Node test double, but real-browser IndexedDB behavior and CryptoKey structured cloning have not yet been verified. They are deliberately not wired into live persistence until startup/save integration, migration, first-run setup, recovery UX, and rollback behavior are complete. Device-key mode protects against casual plaintext inspection but does not protect against malicious same-origin JavaScript or a compromised browser profile. The PBKDF2 work factor must be benchmarked on target mobile browsers before activation; evaluate a maintained local Argon2id bundle if practical.

- Added `vault-runtime.js` as a separate lifecycle coordinator: it distinguishes first-run setup, locked vault, and legacy migration states; requires an explicit setup confirmation before writing the new vault; supports password, recovery-code, and device-key unlock; serializes encrypted saves; and clears the in-memory DEK and plaintext state when locking.
- This was the initial runtime-only checkpoint. It is superseded by the connected implementation status below.

## 10. Updated implementation status — 2026-11-25

The earlier status notes above are historical and are superseded by this section.

### Connected to the application on the security branch
- `index.html` now loads `vault-runtime.js` and `vault-ui.js`.
- Startup waits for vault initialization. A first installation presents password setup; an existing encrypted vault presents an unlock screen; a valid legacy `inkly_v1` record is offered for migration.
- Setup requires a password of at least 12 characters and displays a one-time independent recovery code before the user confirms persistence.
- The application save path now calls the serialized vault runtime. It no longer writes the library through `localStorage.setItem`.
- After successful unlock, the legacy plaintext key is removed where browser storage permits. While locked, the application clears its live state reference; the runtime clears its DEK and decrypted data.
- The UI supports password unlock, recovery-code unlock, and device-key unlock for any pre-existing device-mode vault.
- An inactivity timer locks the vault after five minutes. A hidden page is also locked after five minutes; returning after the timeout triggers a lock.
- Import writes through the encrypted runtime. New exports use an independently passphrase-encrypted backup envelope; legacy plaintext JSON backups remain importable for compatibility.
- Delayed book-of-the-day responses and imports are guarded against completing after the vault has been locked.

### Verification
- GitHub Actions passed on commit `698d265b154e1681c53be5caa3d881ce7daac643`, including 39 Node regression tests. Later commits add plaintext-reference cleanup, background-lock timing hardening, and guards for delayed operations; their workflow results must be checked separately.
- The tests use Node Web Crypto and a fake IndexedDB adapter. They do not establish real-browser IndexedDB behavior, mobile-browser performance, or full user-interface correctness.
- No browser end-to-end test has been completed. The branch is not merged or deployed.

### Remaining release gates
1. Add encrypted backup export/import with a separate backup passphrase, authenticated metadata, validation, and rollback tests.
2. Verify first-run setup, password/recovery unlock, migration, idle lock, restart, and interrupted writes in real mobile and desktop browsers.
3. Benchmark PBKDF2 on target mobile devices and decide whether a pinned local Argon2id implementation is practical.
4. Audit external requests, CSP, script integrity, and third-party dependencies. The book-of-the-day feature currently contacts Google Books for catalogue suggestions; it does not upload the personal library.
5. Test quota errors, IndexedDB failures, two-tab behavior, corrupted vault records, and backup restore before enabling this on the main branch.

The connected implementation is still a draft. Do not treat it as production-ready until these gates pass.

### Encrypted backup status update
Encrypted backup export/import is now implemented in the draft branch. The backup envelope uses a separate user-chosen passphrase (minimum 12 characters), PBKDF2-HMAC-SHA-256 with 600,000 iterations, a fresh 16-byte salt, and AES-256-GCM with a fresh 96-bit nonce and authenticated context. The envelope contains no plaintext library content. Import verifies the encrypted envelope, decrypts it, validates the library structure, previews record counts, asks for replacement confirmation, and writes through the encrypted vault runtime. Legacy plaintext JSON backups remain importable for compatibility; new exports are encrypted. The backup passphrase is not stored by Inkly.

The app currently enforces a 25 MiB file-size limit on import, while the cryptographic backup module has a 50 MiB payload ceiling. PBKDF2 performance still needs testing on target phones. Browser-level verification remains outstanding.


### Multi-tab and browser verification

The UI now requests an exclusive Web Locks API lock for an unlocked vault session where the browser supports it. The lock is released after a successful vault lock and is automatically released by the browser when the owning document is destroyed. Browsers without Web Locks still require the user to keep Inkly to one tab. The coordination behavior has a static regression assertion but still needs a real multi-tab browser test. Real-browser IndexedDB, CryptoKey cloning, mobile KDF timing, interrupted operations, quota errors, and the full setup/unlock/recovery/backup flows still require end-to-end testing.

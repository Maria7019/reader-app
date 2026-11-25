# Inkly — baseline security audit

Audit date: 2026-11-25  
Repository: `Maria7019/reader-app`  
Audited ref: `main`  
Audited file: `index.html`  
Audited blob: `92b85b26b5e30f1b8e00785a44b929736173ca16`

## Scope and integrity

This is a read-only baseline review of the current `main` version. No application runtime code has been changed as part of this audit. Work is isolated on branch `security/audit-baseline`; `main` remains untouched.

## Verified architecture

- The application is a single-page HTML document with inline CSS and JavaScript.
- Persistent application state is read from and written to `localStorage` under key `inkly_v1`.
- The state includes books and their descriptions, opinions, notes, quotes, characters, categories/subcategories, category icon mappings, profile fields, theme, and the cached book-of-the-day object.
- No IndexedDB, Web Crypto, password-based lock, encryption, service worker, or Content Security Policy is present in the audited file.
- Startup normalizes several state properties, but a failed JSON parse falls back to the initial sample state. This can make corrupted data appear to have disappeared even though the old storage entry may still exist.
- The save routine catches storage errors and displays a fatal error, but most mutation handlers change the in-memory state before calling save; there is no rollback mechanism.
- Plain JSON export serializes the full state. Import checks only that `books` and `disciplines` are arrays, then immediately replaces state and saves. There is no preview, schema/version validation, pre-import snapshot, atomic apply, or integrity check.
- The profile screen currently renders several setting rows and export/import labels as static elements. The visible labels are not, by themselves, evidence of working settings workflows.
- One outbound `fetch` call was found: Google Books volumes API, used by the book-of-the-day feature. The request sends a subject query derived from the app's category list. The inspected call does not send the user's book records or notes. Cover images may subsequently be loaded from URLs returned by that service.
- The application contains user-entered cover URL support. Those URLs are rendered as image backgrounds; they should be treated as external network requests and validated/controlled as part of the privacy review.

## Priority risks

### Critical for the planned security work
1. Library content is stored in plaintext in `localStorage`; scripts running in the same origin can read it.
2. The import path can overwrite the current in-memory library and persisted state after only minimal shape checks.
3. The startup fallback to sample state can obscure a parse failure and should not silently initialize over an unreadable existing record.

### Important
4. There is no encrypted backup format or recovery-key workflow.
5. No inactivity lock or password/key management exists.
6. No explicit CSP or dependency policy is present. The file currently has no external script tag, which is a useful starting point.
7. The single-file architecture makes careful, staged changes and regression testing especially important.

## Migration constraints

- Preserve the existing `inkly_v1` payload and every currently recognized property.
- Never delete or overwrite `inkly_v1` during initial migration.
- Before any storage migration, export a byte-for-byte/raw JSON safety copy where possible and verify a restore path.
- Build the new storage alongside the old one, validate counts and representative nested fields, and only then switch the active read/write path.
- Keep rollback available until the new encrypted store has been verified across reloads and browser restarts.
- Do not claim that encryption protects against malicious same-origin JavaScript or a compromised unlocked device.

## Recommended implementation sequence

1. Add a versioned, validated backup/import layer with pre-import snapshot and explicit confirmation. Test malformed JSON, wrong schema, oversized inputs, cancellation, and failed writes.
2. Add explicit recovery from malformed legacy storage without replacing it with sample data.
3. Implement versioned IndexedDB storage and a non-destructive migration from `inkly_v1`.
4. Add encryption/key management only after storage migration is proven. Evaluate a maintained Argon2id implementation versus native PBKDF2; document parameters and browser support.
5. Add optional lock, five-minute inactivity lock, recovery key, encrypted export/import, and destructive-action confirmations.
6. Test offline behavior, browser restart, mobile browsers, quota errors, interrupted imports, wrong passwords, and recovery.

## Current status

Audit baseline recorded. No runtime behavior has been modified yet. The next implementation change should be isolated on this branch and should not be merged into `main` until the migration and backup test plan passes.


## Implementation progress (draft branch)

### Completed in the draft branch
- Added a startup guard: when the existing `inkly_v1` value cannot be read or parsed, normal startup/save is stopped. The user is offered a download of the raw stored value instead of silently falling back and writing sample data.
- Added working ordinary JSON export and restore controls in the profile's Data section.
- New exports use a versioned envelope (`format: inkly-backup`, `version: 1`) while the importer remains compatible with legacy plain-state JSON backups.
- Import rejects unsupported versions, missing required arrays, malformed book records and nested note/quote/character fields, invalid category entries, malformed profile/maps, excessive counts, and files larger than 25 MiB.
- Before replacement, the user sees a summary and confirmation. The current state is downloaded as a separate pre-import backup. If persistence fails, the in-memory state is reverted and the previous raw storage value is restored where possible.
- The inline JavaScript passed a syntax compilation check. Validator checks passed for both supported formats and rejected the tested malformed/unsupported cases.

### Not yet verified
- Actual interaction and downloads in desktop/mobile browsers.
- Interrupted downloads, quota exhaustion and storage-denied behavior in a real browser.
- End-to-end restore against a representative populated user library.
- End-to-end integration of the isolated Web Crypto module with IndexedDB and the UI.
- IndexedDB migration.

The branch remains a draft and must not be merged into `main` until browser testing and the migration plan are complete.


### Empty-library baseline
- Changed the fresh-install initial state to contain no sample book. Default categories and subcategory organization remain available.
- Existing browser storage is intentionally not rewritten to remove a previously saved sample entry automatically; even demo-looking records are preserved rather than silently deleted. A user can remove such an entry through the app if it is present.
- This is separate from the security migration: no IndexedDB migration is needed merely because the user has not added books yet.


### Regression checks
- Added a dependency-free Node.js test suite and GitHub Actions workflow.
- Latest CI run `45620495057` completed successfully: 28 tests passed, 0 failed. Four additional tests exercise the isolated IndexedDB adapter, including CryptoKey persistence and missing-key detection. This includes password and device-key unlock, recovery unlock, wrong-secret rejection, authenticated-tamper detection, nonce uniqueness, KDF metadata validation, plaintext-exclusion checks, update encryption, and payload-size validation.
- Checks cover inline-script syntax, empty first-run library, corrupt-storage startup guard, absence of third-party script tags, legacy/versioned backup validation, malformed records, invalid metadata, and count limits.
- These are static/logic regression checks, not a substitute for real browser interaction tests on Android and desktop.

### Cryptographic core (isolated; not yet active in the app)
- Added a local same-origin `security-core.js` module using Web Crypto AES-256-GCM with 96-bit random nonces and 128-bit authentication tags.
- Library content is encrypted under a randomly generated 256-bit data-encryption key (DEK).
- The DEK is independently wrapped by a password-derived key (PBKDF2-HMAC-SHA-256, 600,000 iterations) when a password is chosen, or by a non-extractable device CryptoKey when the optional app password is omitted. A 256-bit random recovery code independently wraps the DEK in either mode.
- In no-password mode, the non-extractable device CryptoKey must be stored separately in IndexedDB; this provides encryption at rest against casual plaintext inspection, not protection against malicious same-origin JavaScript or a compromised browser profile. Added an isolated IndexedDB adapter that atomically stores the encrypted envelope and, in no-password mode, the non-extractable CryptoKey in one record. The adapter is not yet connected to app startup or save operations. Its Node tests use a test double; real browser IndexedDB and CryptoKey structured-clone behavior remain unverified. The module does not persist passwords or recovery codes. The recovery code is returned once to the future setup flow; secure display/confirmation and user storage are not implemented yet.
- Password and recovery unlock, authenticated decryption, metadata bounds, and nonce separation have automated tests.
- The module is loaded locally but is not yet called by the application. Existing library persistence remains unchanged until the IndexedDB transaction and recovery lifecycle are ready.
- PBKDF2 is a compatibility baseline, not a claim that it is optimal on every phone. Mobile timing must be measured before activation; consider a maintained, locally bundled Argon2id implementation if feasible.

## Implementation progress — 2026-11-25

The draft security branch now connects the encrypted vault runtime to application startup, password setup, recovery-key confirmation, password/recovery unlock, serialized encrypted saves, five-minute inactivity lock, manual lock, encrypted backup export/import, and legacy JSON import. A failed write now keeps the in-memory state available for retry and prevents the idle-lock path from clearing it before a successful retry. Save-success notifications wait for the IndexedDB write to complete.

The most recent confirmed workflow before this note passed 43 tests; one additional test has since been added for the manual lock control and must pass before this checkpoint is considered verified. No real-browser/mobile test has been performed. The main branch remains unchanged; this is still a draft PR.

Remaining critical work: browser-level setup/restart/recovery/import tests, mobile KDF benchmarking, storage-quota and concurrent-tab conflict handling, CSP/dependency/network audit, and final review of data-loss behavior. New backups are encrypted; old plaintext JSON backups remain importable. The book-of-the-day feature contacts Google Books for catalogue suggestions, but the personal library is not uploaded.


## Current integration checkpoint — 2026-11-25

The draft branch now includes `vault-ui.js`, which provides first-run password setup, one-time recovery-key display, password and recovery-key unlock, five-minute inactivity locking, and manual locking. `index.html` routes normal saves, imports, and new encrypted backup exports through the vault runtime. The application no longer calls `localStorage.setItem` for library persistence. A legacy `inkly_v1` record is retained until the encrypted vault has been written successfully; it is then removed where browser storage permits.

The current test file contains 44 Node regression tests, including tests for encrypted backups, runtime lock/save sequencing, failure recovery, UI script parsing, and the encrypted application save path. The latest workflow result verified in this session is an earlier run with 39 tests; the current 44-test revision still needs a fresh successful CI run. Node tests and fake IndexedDB do not substitute for real-browser testing.

Outstanding release gates: verify the 44-test revision in CI; perform real-browser and mobile end-to-end tests; benchmark PBKDF2 on target phones; implement and test cross-tab coordination; test IndexedDB quota, corruption, interrupted writes and restore; audit CSP, network requests and script integrity. The Google Books catalogue request sends a search topic, not the personal library. The draft PR is not merged or deployed.


### Cross-tab session guard

The vault UI now uses the browser Web Locks API to request an exclusive `inkly-vault-session` lock before password, recovery-key, or device-key unlock. A second tab is refused while another tab owns the session lock. The lock is released after a successful manual or inactivity lock. If Web Locks is unavailable, the UI warns the user to keep Inkly in one tab; no cross-browser fallback lease is implemented. Static tests cover the guard's presence, but real multi-tab contention and tab-close behavior still need browser testing.

The current test source contains 46 Node regression tests. GitHub Actions run `45626510855` completed successfully on the current 46-test revision; the regression-test job passed. This verifies the Node test suite, not real-browser behavior.


## Follow-up review — 2026-11-26

A further review of the draft implementation identified an unsafe rendering path for user-supplied book-cover URLs. The URL had been interpolated into an HTML style attribute using JSON stringification; JSON stringification alone is not HTML-attribute or CSS-context escaping. The three affected cover renderers now pass values through a shared sanitizer. It accepts HTTPS URLs and same-origin URLs, rejects other schemes and external HTTP URLs, and HTML-escapes attribute-sensitive characters before inserting the CSS value. Regression tests cover executable schemes, external HTTP, ampersands, encoded quote/attribute payloads, and all three render paths.

The follow-up change is on `security/audit-baseline` only. GitHub Actions run 147 passed on commit `bb77e7578e41bbed03a6078885f8c5d1c4c53774`; the test suite now includes 49 Node regression tests. This is still source-level and Node-level verification. It does not establish that the sanitizer, CSP, vault lifecycle, IndexedDB, or user interface behave correctly in a real browser. The existing inline event-handler architecture also means the CSP still permits `'unsafe-inline'`; removing that exception requires a separate event-handler refactor.

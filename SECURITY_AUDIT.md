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
- Cryptographic protection and encrypted backup format.
- IndexedDB migration.

The branch remains a draft and must not be merged into `main` until browser testing and the migration plan are complete.

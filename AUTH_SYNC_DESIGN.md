# Inkly account authentication and encrypted cross-device sync

Status: architecture checkpoint, not a deployed service.

## Product behavior

Inkly remains a mobile-first web application/PWA. A user can create an account with an email address and password, confirm the email, sign in, request a password-reset email, sign out, and use the same account on another supported device. After sign-in, the encrypted library can be restored or synchronized between devices.

The account is not a substitute for the encrypted vault. The cloud service stores only an authenticated, encrypted vault envelope. Book titles, notes, quotes, opinions, profile details, and other library fields must never be sent as plaintext.

## Proposed provider

Use Supabase Auth + Postgres. Its email/password flow supports email confirmation and password-reset emails. Postgres Row Level Security can enforce per-account access at the database layer. The current static client uses Supabase Auth HTTP endpoints and the PostgREST API through small first-party modules (`auth-rest.js` and `cloud-sync.js`), avoiding a runtime CDN dependency. The browser receives only the project's public/publishable key; the service-role key must never be included in the app, repository, or browser bundle. Auth sessions are persisted in the app's IndexedDB database by `auth-session-store.js`.

Official references:
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Password and encryption model

The intended first implementation uses one user-entered password for both account sign-in and local vault unlock, while keeping the two operations cryptographically separate:
1. Supabase Auth receives the password over HTTPS and handles account credential verification.
2. On the device, Inkly independently derives a key-encryption key with the existing password KDF and uses it only to unwrap the random vault DEK.
3. The server stores only the encrypted vault record, including the wrapped DEK and encrypted library payload. It never receives the password, derived key, DEK, recovery key, or plaintext library.
4. A successful account login alone does not decrypt the library. The local unlock step must also succeed.

The existing recovery code remains independent of the account password. A normal password reset changes the account credential but cannot decrypt the vault. After a reset, the user must unlock the vault with the recovery code and re-wrap/re-encrypt the vault under the new account password. This limitation must be stated clearly in the reset flow; never imply that an email reset can recover end-to-end encrypted data.

For an existing local vault, account linking must be an explicit migration. Inkly must verify the current local vault password, create a fresh encrypted envelope protected by the account password, issue a new recovery code, ask the user to save it, and verify the replacement before uploading. The old local record and a verified encrypted backup must remain available until the new local and cloud copies have been read back and verified. Device-key-only vaults cannot be synchronized as-is; they must first be upgraded to password-protected encryption.

## Cloud record and access control

One row per authenticated user is stored in `public.vault_sync`:
- `user_id`: Auth user UUID, primary key.
- `envelope`: JSON object containing only the versioned encrypted vault envelope.
- `revision`: server-controlled monotonically increasing integer.
- `updated_at`: server-controlled timestamp.

RLS permits an authenticated user to select, insert, or update only the row whose `user_id` equals `auth.uid()`. Anonymous access is denied. No service-role key or privileged server credential is needed in the mobile client.

The migration is in `supabase/migrations/`. It enables RLS, revokes broad default grants, grants only the required operations, and increments the revision in a database trigger.

## Synchronization protocol

- On sign-in, read the user's cloud row.
- If no cloud row exists, offer to upload the current local encrypted vault after account-linking checks.
- If a cloud row exists and this device has no linked copy, download the envelope, validate its format and size, persist it locally, then ask for the vault password/recovery code to unlock.
- For an ordinary save, write locally first, then upload the latest encrypted envelope using compare-and-swap on the expected revision.
- If the revision changed on the server, stop. Do not silently use last-write-wins and do not overwrite either copy. Present a conflict choice: reload the cloud copy, or preserve/export the local copy before resolving.
- A network failure leaves the local encrypted save intact and marks sync as pending. Retry with bounded backoff; never claim that cloud sync completed until the server confirms it.
- Sign-out clears the auth session and decrypted in-memory vault state. The local encrypted vault remains on the device unless the user explicitly chooses to remove it.

This first version deliberately avoids background merging of individual books. Whole-vault revision checks are simpler and safer; record-level merge can be designed later if needed.

## Mobile web/PWA requirements

- Configure the real HTTPS app origin as the only allowed email-confirmation and password-reset redirect.
- Persist the Supabase access/refresh token pair only in the IndexedDB auth-session object store. Never write auth tokens to localStorage. Supabase email confirmation and recovery callbacks can return tokens in the URL fragment; read them immediately, persist the session, and remove the fragment from browser history.
- Bundle the SDK locally at build time; do not load an unpinned third-party script from a CDN at runtime.
- Extend CSP `connect-src` only with the exact configured Supabase project origin. Keep the existing Google Books origin separately allowlisted.
- Handle email links that reopen an installed PWA/browser tab and complete the PKCE callback safely.
- Do not cache authenticated API responses or encrypted sync payloads in a public service-worker cache.

## Required account configuration

The repository cannot create a Supabase project or configure its email delivery without the owner's action. Before live registration can work, the owner must:
1. Create a Supabase project in their own account.
2. Configure email confirmation, password-reset redirect URLs, and a production SMTP sender.
3. Run the checked-in SQL migration in that project.
4. Supply the project's URL and public/publishable key through the documented public app configuration. Never provide a service-role key.
5. Configure the deployed app's exact HTTPS origin.

The hosted Supabase test email service is rate-limited and best-effort; production email confirmation/reset requires configured SMTP.

## Release gates

- Auth: signup, duplicate email handling, confirmation, sign-in, sign-out, expired session, password reset, and reset callback.
- Encryption: verify the network payload contains no plaintext library fields or key material; wrong password and wrong recovery code fail.
- Multi-device: first device upload, second device restore, subsequent update, offline pending state, simultaneous writes, revision conflict, and recovery after password reset.
- Storage: custom auth-session persistence in IndexedDB, local vault migration, browser restart, PWA launch from email links, and logout behavior.
- Database: pgTAP tests for RLS isolation across two users and denial of anonymous access.
- Mobile: test on the target Android browser and installed PWA; measure KDF latency and verify email callback behavior.
- Do not merge or deploy until these gates pass.

## Current implementation boundary

The feature branch now includes the public project configuration, Auth REST wrapper, IndexedDB session persistence, email/password registration and sign-in UI, password-reset callback handling with recovery-key rewrapping, encrypted-envelope export/install, revision-aware cloud sync, a fresh-device cloud restore path, and a mobile PWA manifest/service worker. Node regression tests cover the cryptographic rewrap and static module parsing. The hosted database migration, email delivery, allowed callback URL, live auth flows, browser/Android behavior, and multi-device end-to-end testing are still pending. Therefore live account creation and cloud sync must not yet be marked as production-verified.

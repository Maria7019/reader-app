# Supabase setup for Inkly

This guide is for the owner of the Inkly Supabase project. Do not send passwords, recovery codes, service-role keys, or database credentials to anyone.

## 1. Create a project

1. Sign in to https://supabase.com/dashboard.
2. Create a new project in your own Supabase organization.
3. Choose a project name such as `inkly`, a strong unique database password, and a region appropriate for your users and applicable data-residency requirements.
4. Save the database password in your password manager. It is not needed in the mobile app.

Do not create a public storage bucket for the library. Inkly stores one encrypted envelope in Postgres.

## 2. Configure email authentication

In Authentication settings:
- Keep email/password sign-in enabled.
- Require email confirmation.
- Configure the password-reset and confirmation redirect URLs to the exact HTTPS origin/path where the installed mobile web app will run.
- Configure a production SMTP provider before real users depend on confirmation or password-reset mail. Supabase's default test sender is rate-limited and best-effort.

Do not disable email confirmation for production.

## 3. Apply the database migration

After the project exists, open its SQL Editor and run the contents of:

`supabase/migrations/20261128000000_create_vault_sync.sql`

The migration creates the encrypted-envelope table, enables Row Level Security, removes anonymous table grants, restricts rows to the signed-in owner, and adds server-controlled revision metadata.

The pgTAP isolation test is at `supabase/tests/vault_sync_rls_test.sql`; the repository's Supabase GitHub Actions workflow runs it against a local Supabase stack.

## 4. Obtain only the public client configuration

From Project Settings → API (or the current API Keys page), copy:
- Project URL
- Publishable key (or legacy anon key, if that is what the project exposes)

These values are public client configuration, not passwords. They may be embedded in the app. Never copy the `service_role` key, secret API keys, database password, or SMTP password into the repository or mobile app.

Inkly's client configuration file and local build integration will be added after the project URL and app origin are known. Do not paste credentials into source files or commit them to GitHub.

## 5. Before enabling registration

The live app must have a stable HTTPS address so confirmation and password-reset links return to the correct mobile PWA. The final callback URL must be added to Supabase's allowed redirect URLs. The auth client must be locally bundled, use IndexedDB-backed session persistence, and be tested on the target Android browser.

Creating the Supabase project does not publish Inkly and does not by itself enable registration. The app integration and end-to-end encryption checks must also pass.

# Inkly — release verification checklist

This checklist is for the final manual verification of the draft security branch. It must be completed in a real browser before the branch is considered ready for merge or deployment.

## Test environment
- [ ] Record browser name and exact version.
- [ ] Record device and operating system.
- [ ] Record whether the browser is mobile or desktop.
- [ ] Use a disposable test profile and test data. Do not use the only copy of a real library.

## First launch and migration
- [ ] Fresh install opens the Inkly first-run setup, with no sample books or pre-populated personal library.
- [ ] Create a password meeting the minimum length.
- [ ] Recovery credential is displayed and can be copied/saved outside the browser.
- [ ] Complete setup and confirm the empty library opens.
- [ ] With a test legacy `inkly_v1` record, verify migration preserves all books, notes, quotes, categories, profile fields, and settings.
- [ ] Verify the legacy record is not discarded if vault creation or migration fails.

## Unlock and lock lifecycle
- [ ] Reload while locked; verify the password unlock screen appears.
- [ ] Enter an incorrect password; verify unlock is refused and data remains intact.
- [ ] Unlock with the correct password.
- [ ] Manually lock; verify the library content is no longer visible.
- [ ] Unlock with the recovery credential.
- [ ] Leave the app idle for five minutes; verify it locks.
- [ ] Hide the tab for five minutes and return; verify it locks.
- [ ] Close and reopen the browser; verify password unlock works.
- [ ] Open a second tab while the first is unlocked; verify the second tab is refused when Web Locks is supported.
- [ ] In a browser without Web Locks, verify the one-tab warning is visible.

## Editing and persistence
- [ ] Create, edit, and delete a test book.
- [ ] Add and edit notes, quotes, opinions, and characters.
- [ ] Change categories, theme, and profile fields.
- [ ] Reload after saving; verify all changes persist.
- [ ] Simulate or induce a storage write failure where practical; verify the UI reports failure and does not silently claim the change was saved.
- [ ] Check browser console for uncaught errors during these operations.

## Backup and restore
- [ ] Export a new encrypted backup.
- [ ] Confirm the export asks for a separate backup passphrase.
- [ ] Import it into a disposable profile and verify the restored test library.
- [ ] Try an incorrect backup passphrase; verify import is refused without replacing current data.
- [ ] Tamper with a copy of the encrypted backup; verify authentication failure and no replacement.
- [ ] Cancel the restore confirmation; verify current data remains unchanged.
- [ ] Import a legacy plaintext JSON backup in a disposable profile and verify compatibility.
- [ ] Try malformed, oversized, and structurally invalid backup files; verify safe rejection.

## Browser storage and device checks
- [ ] Verify encrypted vault records are stored in IndexedDB and that personal library content is not persisted as plaintext in localStorage.
- [ ] Verify IndexedDB quota or unavailable-storage errors are surfaced without silent data loss.
- [ ] Repeat setup, unlock, lock, save, and backup tests on the target Android browser.
- [ ] Record the time taken for password setup and unlock on the target phone; check that it is usable and does not freeze the interface.
- [ ] Verify cover images and the book-of-the-day feature work; inspect network requests to confirm personal library data, password, and recovery credential are not sent.

## Security policy follow-up
- [ ] Review all remaining inline event handlers and replace them with event delegation.
- [ ] Only after the handlers are removed, remove `'unsafe-inline'` from the script CSP and retest every interaction.
- [ ] Review all external requests, remote image behavior, and dependency/update policy.

## Sign-off
- Browser/device test results recorded:
- Known failures:
- Tester/date:
- Decision: [ ] Ready for review  [ ] Not ready

Automated Node regression tests and GitHub Actions are necessary but do not replace this checklist. Do not merge or deploy until the applicable browser tests pass and known failures are reviewed.

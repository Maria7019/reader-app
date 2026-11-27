const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../security-core.js');

test('account and cloud modules parse without runtime syntax errors', () => {
  for (const file of ['auth-session-store.js','auth-rest.js','cloud-sync.js','auth-ui.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotThrow(() => new Function(source), file + ' must parse');
  }
});

test('password reset can rewrap the same DEK using the independent recovery key', async () => {
  const data = { books: [{ title: 'Private title', notes: ['private note'] }], disciplines: ['Литература'] };
  const created = await core.createVault(data, 'original vault password 2026');
  const changed = await core.rewrapPasswordWithRecovery(created.record, created.recoveryCode, 'replacement vault password 2026');
  assert.equal(core.validateRecord(changed), true);
  const newKey = await core.unlockWithPassword(changed, 'replacement vault password 2026');
  assert.deepEqual(await core.decryptLibrary(changed, newKey), data);
  await assert.rejects(core.unlockWithPassword(changed, 'original vault password 2026'));
  const recoveryKey = await core.unlockWithRecoveryCode(changed, created.recoveryCode);
  assert.deepEqual(await core.decryptLibrary(changed, recoveryKey), data);
});

test('recovery-key password rewrap rejects a wrong recovery key without changing the source record', async () => {
  const created = await core.createVault({ books: [], disciplines: [] }, 'original vault password 2026');
  const original = JSON.stringify(created.record);
  await assert.rejects(core.rewrapPasswordWithRecovery(created.record, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'replacement vault password 2026'));
  assert.equal(JSON.stringify(created.record), original);
});

test('device-only vault can be upgraded to password wrapping with its recovery key', async () => {
  const data = { books: [], disciplines: ['Философия'] };
  const created = await core.createVault(data, null);
  const upgraded = await core.rewrapPasswordWithRecovery(created.record, created.recoveryCode, 'new cloud vault password 2026');
  assert.ok(upgraded.passwordWrap);
  assert.equal(upgraded.deviceWrap, null);
  const key = await core.unlockWithPassword(upgraded, 'new cloud vault password 2026');
  assert.deepEqual(await core.decryptLibrary(upgraded, key), data);
});

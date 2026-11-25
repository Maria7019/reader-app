const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
const securityCore = require('../security-core.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(scriptMatch, 'the application must contain its inline script');
const source = scriptMatch[1];

test('the complete inline application script parses', () => {
  assert.doesNotThrow(() => new Function(source));
});

test('a fresh installation starts with an empty book list', () => {
  assert.match(source, /initial=\{books:\[\],disciplines:/);
});

test('unreadable storage stops normal startup and does not autosave defaults', () => {
  assert.match(source, /if\(storageLoadError\)\{showStorageRecovery\(\)\}else\{render\(\);save\(\)\}/);
  assert.match(source, /rawStoredState=localStorage\.getItem\(KEY\)/);
});

test('only a same-origin local security script is loaded', () => {
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*["']https?:/i);
  assert.match(html, /<script src="\.\/security-core\.js"><\/script>/);
});

const validatorStart = source.indexOf('function validateBackupObject(value){');
const validatorEnd = source.indexOf('function importBackup(e)', validatorStart);
assert.notEqual(validatorStart, -1, 'backup validator must exist');
assert.notEqual(validatorEnd, -1, 'backup importer must follow the validator');
const validateBackupObject = new Function(
  source.slice(validatorStart, validatorEnd) + '; return validateBackupObject;'
)();

test('accepts a legacy JSON backup', () => {
  const data = { books: [], disciplines: [] };
  assert.equal(validateBackupObject(data), data);
});

test('accepts the current versioned backup envelope', () => {
  const data = { books: [], disciplines: [] };
  assert.equal(validateBackupObject({ format: 'inkly-backup', version: 1, data }), data);
});

test('rejects an unsupported backup version', () => {
  assert.throws(
    () => validateBackupObject({ format: 'inkly-backup', version: 2, data: { books: [], disciplines: [] } }),
    /Версия резервной копии не поддерживается/
  );
});

test('rejects missing required arrays', () => {
  assert.throws(() => validateBackupObject({ disciplines: [] }));
  assert.throws(() => validateBackupObject({ books: [] }));
});

test('rejects malformed book records and nested collections', () => {
  assert.throws(() => validateBackupObject({ books: [null], disciplines: [] }));
  assert.throws(() => validateBackupObject({ books: [{ notes: 'not-an-array' }], disciplines: [] }));
  assert.throws(() => validateBackupObject({ books: [{ quotes: {} }], disciplines: [] }));
  assert.throws(() => validateBackupObject({ books: [{ characters: 'bad' }], disciplines: [] }));
});

test('rejects malformed categories and metadata maps', () => {
  assert.throws(() => validateBackupObject({ books: [], disciplines: [' ', 4] }));
  assert.throws(() => validateBackupObject({ books: [], disciplines: [], subdisciplines: [] }));
  assert.throws(() => validateBackupObject({ books: [], disciplines: [], disciplineIcons: null }));
});

test('rejects malformed profile data', () => {
  assert.throws(() => validateBackupObject({ books: [], disciplines: [], profile: [] }));
});

test('enforces record-count limits', () => {
  assert.throws(() => validateBackupObject({ books: Array(10001).fill({}), disciplines: [] }));
  assert.throws(() => validateBackupObject({ books: [], disciplines: Array(501).fill('Category') }));
});

test('the cryptographic core exposes the expected AES-GCM vault format', () => {
  assert.equal(securityCore.format, 'inkly-encrypted-v1');
  assert.equal(securityCore.pbkdf2Iterations, 600000);
});

test('password and recovery key independently unlock the same encrypted library', async () => {
  const data = { books: [], disciplines: ['Литература'], profile: { name: 'Reader' } };
  const created = await securityCore.createVault(data, 'correct horse battery staple');
  assert.equal(securityCore.validateRecord(created.record), true);
  const passwordKey = await securityCore.unlockWithPassword(created.record, 'correct horse battery staple');
  assert.deepEqual(await securityCore.decryptLibrary(created.record, passwordKey), data);
  const recoveryKey = await securityCore.unlockWithRecoveryCode(created.record, created.recoveryCode);
  assert.deepEqual(await securityCore.decryptLibrary(created.record, recoveryKey), data);
});

test('wrong password and wrong recovery key cannot decrypt the vault', async () => {
  const created = await securityCore.createVault({ books: [], disciplines: [] }, 'correct horse battery staple');
  await assert.rejects(securityCore.unlockWithPassword(created.record, 'incorrect horse battery staple'));
  await assert.rejects(securityCore.unlockWithRecoveryCode(created.record, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
});

test('authenticated encryption detects modified ciphertext', async () => {
  const created = await securityCore.createVault({ books: [], disciplines: [] }, 'correct horse battery staple');
  const key = await securityCore.unlockWithPassword(created.record, 'correct horse battery staple');
  const changed = structuredClone(created.record);
  const bytes = Buffer.from(changed.payload.ciphertext, 'base64');
  bytes[bytes.length - 1] ^= 1;
  changed.payload.ciphertext = bytes.toString('base64');
  await assert.rejects(securityCore.decryptLibrary(changed, key));
});

test('vault metadata validation rejects weak KDF settings', () => {
  const valid = {
    format: 'inkly-encrypted-v1',
    version: 1,
    kdf: { name: 'PBKDF2-HMAC-SHA-256', iterations: 600000 },
    passwordWrap: { salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(16).toString('base64') },
    recoveryWrap: { iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(16).toString('base64') },
    payload: { iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(16).toString('base64') }
  };
  assert.equal(securityCore.validateRecord(valid), true);
  assert.throws(() => securityCore.validateRecord({ ...valid, kdf: { name: 'PBKDF2-HMAC-SHA-256', iterations: 1000 } }));
  assert.throws(() => securityCore.validateRecord({ ...valid, kdf: { name: 'SHA-256', iterations: 600000 } }));
});

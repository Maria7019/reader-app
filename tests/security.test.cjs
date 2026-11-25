const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\\s\\S]*?)<\\/script>/i);

assert.ok(scriptMatch, 'the application must contain its inline script');
const source = scriptMatch[1];

test('the complete inline application script parses', () => {
  assert.doesNotThrow(() => new Function(source));
});

test('a fresh installation starts with an empty book list', () => {
  assert.match(source, /initial=\\{books:\\[\\],disciplines:/);
});

test('unreadable storage stops normal startup and does not autosave defaults', () => {
  assert.match(source, /if\\(storageLoadError\\)\\{showStorageRecovery\\(\\)\\}else\\{render\\(\\);save\\(\\)\\}/);
  assert.match(source, /rawStoredState=localStorage\\.getItem\\(KEY\\)/);
});

test('the page does not load third-party JavaScript directly', () => {
  assert.doesNotMatch(html, /<script\\b[^>]*\\bsrc\\s*=/i);
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
  assert.equal(
    validateBackupObject({ format: 'inkly-backup', version: 1, data }),
    data
  );
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

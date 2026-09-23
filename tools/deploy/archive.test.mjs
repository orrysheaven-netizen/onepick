import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const LIMIT = 1024 * 1024;
const python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
const reader = fileURLToPath(new URL('./read-plan-archive.py', import.meta.url));
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Construct untrusted ZIP bytes in memory; no archive is extracted or written.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name = 'plan.json', data = Buffer.from('{}'), flags = 0, deflated = false, corrupt = false } of entries) {
    const filename = Buffer.from(name);
    const content = deflated ? deflateRawSync(data) : data;
    const checksum = crc32(data) ^ (corrupt ? 1 : 0);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6); header.writeUInt16LE(deflated ? 8 : 0, 8);
    header.writeUInt32LE(checksum >>> 0, 14); header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, content);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(deflated ? 8 : 0, 10);
    directory.writeUInt32LE(checksum >>> 0, 16); directory.writeUInt32LE(content.length, 20);
    directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + content.length;
  }
  const directory = Buffer.concat(central), ending = Buffer.alloc(22);
  ending.writeUInt32LE(0x06054b50, 0); ending.writeUInt16LE(entries.length, 8); ending.writeUInt16LE(entries.length, 10);
  ending.writeUInt32LE(directory.length, 12); ending.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, ending]);
}
function read(data) {
  const result = spawnSync(python, [reader], { input: data, encoding: 'utf8', shell: false, timeout: 10000, maxBuffer: 2 * LIMIT });
  assert.ifError(result.error);
  return result;
}

test('archive reader returns exactly one bounded UTF-8 plan without extracting', () => {
  const text = '{"message":"제철 추천","schemaVersion":1}\n';
  for (const deflated of [false, true]) {
    const result = read(zip([{ data: Buffer.from(text), deflated }]));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, text);
    assert.equal(result.stderr, '');
  }
});

for (const [name, data] of [
  ['path traversal', zip([{ name: '../plan.json' }])],
  ['absolute path', zip([{ name: '/plan.json' }])],
  ['nested file', zip([{ name: 'folder/plan.json' }])],
  ['backslash traversal', zip([{ name: '..\\plan.json' }])],
  ['wrong filename', zip([{ name: 'script.py' }])],
  ['directory entry', zip([{ name: 'plan.json/' }])],
  ['extra member', zip([{}, { name: 'extra.txt' }])],
  ['duplicate plan member', zip([{}, {}])],
  ['empty archive', zip([])],
  ['encrypted entry', zip([{ flags: 1 }])],
  ['invalid UTF-8', zip([{ data: Buffer.from([0xff]) }])],
  ['bad CRC', zip([{ corrupt: true }])],
  ['uncompressed expansion limit', zip([{ data: Buffer.alloc(LIMIT + 1, 97), deflated: true }])],
  ['raw archive limit', Buffer.alloc(LIMIT + 1)],
  ['invalid ZIP bytes', Buffer.from('not an archive')],
]) {
  test(`archive reader rejects ${name} with a generic error and no output`, () => {
    const result = read(data);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.replace(/\r\n/g, '\n'), 'Invalid deployment plan archive\n');
  });
}

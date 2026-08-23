const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getOfficecliRef, buildRef } = require('../server/officecliRef.js');

const officecliPath = path.join(__dirname, '..', 'vendor', 'officecli', 'officecli.exe');

test('buildRef 生成包含全部格式与元素的能力索引', () => {
  const text = buildRef(officecliPath);
  assert.match(text, /格式 xlsx/);
  assert.match(text, /格式 docx/);
  assert.match(text, /格式 pptx/);
  assert.match(text, /cell/);
  assert.match(text, /ops 图例/);
  // 足够紧凑，可安全注入 system prompt
  assert.ok(Buffer.byteLength(text, 'utf8') < 20000, '索引应小于 20KB');
});

test('getOfficecliRef 命中缓存且可重复调用', () => {
  const a = getOfficecliRef(officecliPath);
  const b = getOfficecliRef(officecliPath);
  assert.ok(a.length > 0);
  assert.equal(a, b);
});

test('officecli 不存在时返回空串', () => {
  assert.equal(getOfficecliRef(path.join('Z:', 'no-such', 'officecli.exe')), '');
});

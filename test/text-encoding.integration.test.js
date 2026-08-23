const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, releaseOfficeCli, removeDir } = require('./helpers.js');

test('text-encoding 集成：GBK 转 UTF-8', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-enc-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.txt');

  // 手工构造 GBK 字节：你好 = C4E3 BAC3
  fs.writeFileSync(input, Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));

  const output = path.join(work, 'out.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('text-encoding', { inputFile: inputDir, from: 'gbk', to: 'utf8', output });

  assert.equal(res.ok, true);
  const buf = fs.readFileSync(output);
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  assert.equal(text, '你好');
});

test('text-encoding 集成：auto 检测 UTF-8 BOM', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-enc2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.txt');
  fs.writeFileSync(input, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf8')]));

  const output = path.join(work, 'out.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('text-encoding', { inputFile: inputDir, from: 'auto', to: 'utf8', output });

  assert.equal(res.ok, true);
  const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
  assert.equal(text, '中文');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, releaseOfficeCli, removeDir } = require('./helpers.js');

test('txt-merge 集成：按顺序合并多个文本文件', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-txtmerge-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const f1 = path.join(inputDir, '一.txt');
  const f2 = path.join(inputDir, '二.txt');
  fs.writeFileSync(f1, '第一部分', 'utf8');
  fs.writeFileSync(f2, '第二部分', 'utf8');

  const output = path.join(work, 'merged.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('txt-merge', { inputFiles: [f1, f2], output });

  assert.equal(res.ok, true);
  const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
  assert.equal(text, '第一部分第二部分'); // 默认直接拼接

  releaseOfficeCli();
  removeDir(work);
});

test('txt-merge 集成：带分隔符合并', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-txtmerge2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const f1 = path.join(inputDir, 'a.txt');
  const f2 = path.join(inputDir, 'b.txt');
  fs.writeFileSync(f1, '甲', 'utf8');
  fs.writeFileSync(f2, '乙', 'utf8');

  const output = path.join(work, 'merged.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('txt-merge', { inputFiles: [f1, f2], separator: '\n', output });

  assert.equal(res.ok, true);
  const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
  assert.equal(text, '甲\n乙');

  releaseOfficeCli();
  removeDir(work);
});

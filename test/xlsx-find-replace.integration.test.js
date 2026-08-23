const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-find-replace 集成：大小写不敏感子串替换', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-findrep-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['姓名', '城市', '备注'],
    ['Alice', 'beijing', '来自 beijing'],
    ['Bob', 'Shanghai', '无']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-find-replace', { inputFile: inputDir, find: 'beijing', replace: '北京', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['B2'], '北京');
  assert.equal(cells['C2'], '来自 北京');
  assert.equal(cells['A2'], 'Alice'); // 不相关单元格不受影响
  // 原文件未改动
  const orig = await readCells(input);
  assert.equal(orig['B2'], 'beijing');

  releaseOfficeCli();
  removeDir(work);
});

test('xlsx-find-replace 集成：区分大小写模式', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-findrep2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['姓名'],
    ['Apple'],
    ['apple']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-find-replace', { inputFile: inputDir, find: 'Apple', replace: '苹果', matchCase: '是', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A2'], '苹果');
  assert.equal(cells['A3'], 'apple'); // 小写不替换

  releaseOfficeCli();
  removeDir(work);
});

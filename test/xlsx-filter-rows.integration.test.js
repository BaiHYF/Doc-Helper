const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-filter-rows 集成：保留匹配行', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-filter-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['状态', '金额'],
    ['已完成', '100'],
    ['进行中', '200'],
    ['已完成', '300'],
    ['已取消', '50']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-filter-rows', { inputFile: inputDir, column: '状态', keyword: '已完成', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A1'], '状态');
  assert.equal(cells['A2'], '已完成');
  assert.equal(cells['A3'], '已完成');
  assert.equal(cells['A4'], undefined); // 其余行被过滤

  releaseOfficeCli();
  removeDir(work);
});

test('xlsx-filter-rows 集成：删除匹配行（keep=否）', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-filter2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['状态', '金额'],
    ['已完成', '100'],
    ['进行中', '200'],
    ['已取消', '50']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-filter-rows', { inputFile: inputDir, column: '状态', keyword: '已取消', keep: '否', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A1'], '状态');
  assert.equal(cells['A2'], '已完成');
  assert.equal(cells['A3'], '进行中');
  assert.equal(cells['A4'], undefined); // 已取消被删除

  releaseOfficeCli();
  removeDir(work);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-unique-values 集成：按列名提取去重唯一值', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uniq-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['城市', '人口'],
    ['北京', '2000'],
    ['上海', '2500'],
    ['北京', '2000'],
    ['广州', '1500']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-unique-values', { inputFile: inputDir, column: '城市', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A1'], '城市');
  assert.equal(cells['A2'], '北京');
  assert.equal(cells['A3'], '上海');
  assert.equal(cells['A4'], '广州');
  assert.equal(cells['A5'], undefined); // 只有 4 个唯一值（含表头）

  releaseOfficeCli();
  removeDir(work);
});

test('xlsx-unique-values 集成：按列号提取', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uniq2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['姓名', '组别'],
    ['甲', 'A'],
    ['乙', 'B'],
    ['丙', 'A']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-unique-values', { inputFile: inputDir, column: '2', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A1'], '组别');
  assert.equal(cells['A2'], 'A');
  assert.equal(cells['A3'], 'B');

  releaseOfficeCli();
  removeDir(work);
});

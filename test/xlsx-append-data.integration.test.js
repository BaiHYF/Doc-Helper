const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-append-data 集成：表头按列名对齐，列取并集、缺失列留空', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-append-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);

  await makeWorkbook(path.join(inputDir, '一.xlsx'), 'S1', [
    ['姓名', '年龄'],
    ['Alice', 30],
    ['Bob', 25]
  ]);
  await makeWorkbook(path.join(inputDir, '二.xlsx'), 'S2', [
    ['姓名', '年龄'],
    ['Carol', 40]
  ]);
  await makeWorkbook(path.join(inputDir, '三.xlsx'), 'S3', [
    ['姓名', '分数'],
    ['Dave', 88]
  ]);

  const output = path.join(work, 'merged.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-append-data', { inputDir, output });

  assert.equal(res.ok, true);
  assert.deepEqual(res.outputFiles, [output]);
  assert.equal(res.rows, 4);
  assert.deepEqual(res.columns, ['姓名', '年龄', '分数']);

  const cells = await readCells(output);
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['B1'], '年龄');
  assert.equal(cells['C1'], '分数');
  assert.equal(cells['A2'], 'Alice');
  assert.equal(cells['B2'], '30');
  assert.equal(cells['A3'], 'Bob');
  assert.equal(cells['B3'], '25');
  assert.equal(cells['A4'], 'Carol');
  assert.equal(cells['B4'], '40');
  // 三号文件只有 姓名/分数：年龄列留空
  assert.equal(cells['A5'], 'Dave');
  assert.equal(cells['B5'], undefined);
  assert.equal(cells['C5'], '88');

  releaseOfficeCli();
  removeDir(work);
});

test('xlsx-append-data 集成：按整行去重', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-append2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);

  await makeWorkbook(path.join(inputDir, 'a.xlsx'), 'S1', [
    ['姓名', '年龄'],
    ['Alice', 30],
    ['Bob', 25]
  ]);
  await makeWorkbook(path.join(inputDir, 'b.xlsx'), 'S2', [
    ['姓名', '年龄'],
    ['Alice', 30], // 与第一个文件重复
    ['Carol', 40]
  ]);

  const output = path.join(work, 'merged.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-append-data', { inputDir, output, dedupe: '是' });

  assert.equal(res.ok, true);
  assert.equal(res.rows, 3); // 4 条 - 1 重复
  assert.equal(res.removedDuplicates, 1);

  const cells = await readCells(output);
  assert.equal(cells['A2'], 'Alice');
  assert.equal(cells['A3'], 'Bob');
  assert.equal(cells['A4'], 'Carol');

  releaseOfficeCli();
  removeDir(work);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-split-column 集成：按逗号拆分一列为多列', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-splitcol-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['姓名', '标签'],
    ['甲', '红,大'],
    ['乙', '蓝,小,加急'],
    ['丙', '绿']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-split-column', { inputFile: inputDir, column: '标签', delimiter: ',', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['A2'], '甲');
  assert.equal(cells['B2'], '红');
  assert.equal(cells['C2'], '大');
  assert.equal(cells['D2'], undefined); // 甲只有 2 段
  assert.equal(cells['B3'], '蓝');
  assert.equal(cells['C3'], '小');
  assert.equal(cells['D3'], '加急');
  assert.equal(cells['B4'], '绿');
  assert.equal(cells['C4'], undefined);

  releaseOfficeCli();
  removeDir(work);
});

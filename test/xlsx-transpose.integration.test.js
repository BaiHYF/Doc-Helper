const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-transpose 集成：行列互换', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-transpose-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['姓名', '年龄'],
    ['甲', '20'],
    ['乙', '30']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-transpose', { inputFile: inputDir, output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  // 转置后：第一行变为第一列
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['A2'], '年龄');
  assert.equal(cells['B1'], '甲');
  assert.equal(cells['B2'], '20');
  assert.equal(cells['C1'], '乙');
  assert.equal(cells['C2'], '30');

  releaseOfficeCli();
  removeDir(work);
});

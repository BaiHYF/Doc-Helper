const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-merge-columns 集成：多列合为一列', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mergecol-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.xlsx');
  await makeWorkbook(input, '数据', [
    ['姓', '名'],
    ['张', '三'],
    ['李', '四']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-merge-columns', { inputFile: inputDir, columns: '姓,名', delimiter: '', output });

  assert.equal(res.ok, true);
  const cells = await readCells(output);
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['A2'], '张三');
  assert.equal(cells['A3'], '李四');
  assert.equal(cells['B2'], undefined); // 被合并的列已清空

  releaseOfficeCli();
  removeDir(work);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbookMulti, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-split 集成：每个工作表拆成独立 xlsx 文件', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-split-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const inputFile = path.join(inputDir, '总表.xlsx');

  await makeWorkbookMulti(inputFile, [
    { name: '一月', rows: [['姓名', '金额'], ['甲', 100]] },
    { name: '二月', rows: [['姓名', '金额'], ['乙', 200]] }
  ]);

  const outputDir = path.join(work, 'out');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-split', { inputFile: inputDir, outputDir });

  assert.equal(res.ok, true);
  assert.equal(res.outputFiles.length, 2);
  assert.deepEqual(res.sheets, ['一月', '二月']);
  assert.ok(fs.existsSync(path.join(outputDir, '一月.xlsx')));
  assert.ok(fs.existsSync(path.join(outputDir, '二月.xlsx')));

  // 校验拆分文件内容与工作表名
  const jan = await readCells(path.join(outputDir, '一月.xlsx'));
  assert.equal(jan['A1'], '姓名');
  assert.equal(jan['A2'], '甲');
  assert.equal(jan['B2'], '100');

  const feb = await readCells(path.join(outputDir, '二月.xlsx'));
  assert.equal(feb['A2'], '乙');
  assert.equal(feb['B2'], '200');

  releaseOfficeCli();
  removeDir(work);
});

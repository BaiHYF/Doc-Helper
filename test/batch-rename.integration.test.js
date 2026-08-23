const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, releaseOfficeCli, removeDir } = require('./helpers.js');

test('batch-rename 集成：序号编号 + 查找替换重命名', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-batchren-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const f1 = path.join(inputDir, '报告初稿.docx');
  const f2 = path.join(inputDir, '报告终稿.docx');
  fs.writeFileSync(f1, 'a');
  fs.writeFileSync(f2, 'b');

  const outputDir = path.join(work, 'out');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });

  // mode=number：序号编号
  const res = await runner.runTool('batch-rename', {
    inputFiles: [f1, f2],
    mode: 'number', startNumber: '1', outputDir
  });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(path.join(outputDir, '01.docx')));
  assert.ok(fs.existsSync(path.join(outputDir, '02.docx')));

  // mode=replace：查找替换
  const outputDir2 = path.join(work, 'out2');
  const res2 = await runner.runTool('batch-rename', {
    inputFiles: [f1, f2],
    mode: 'replace', find: '报告', replace: '报表', outputDir: outputDir2
  });
  assert.equal(res2.ok, true);
  assert.ok(fs.existsSync(path.join(outputDir2, '报表初稿.docx')));
  assert.ok(fs.existsSync(path.join(outputDir2, '报表终稿.docx')));

  releaseOfficeCli();
  removeDir(work);
});

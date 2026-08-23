const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-extract-notes 集成：提取全部备注', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-notes-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [
    { title: '一', notes: '备注甲' },
    { title: '二', notes: '备注乙' }
  ]);

  const output = path.join(work, 'out.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-extract-notes', { inputFile: inputDir, output });

  assert.equal(res.ok, true);
  const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
  assert.ok(text.includes('备注甲'));
  assert.ok(text.includes('备注乙'));

  releaseOfficeCli();
  removeDir(work);
});

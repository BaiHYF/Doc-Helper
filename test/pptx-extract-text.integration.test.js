const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, readPptxSlides, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-extract-text 集成：提取全部幻灯片文本', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-txt-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [
    { title: '封面', body: '欢迎使用' },
    { title: '正文页', body: '内容说明' }
  ]);

  const output = path.join(work, 'out.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-extract-text', { inputFile: inputDir, output });

  assert.equal(res.ok, true);
  const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
  assert.ok(text.includes('封面'));
  assert.ok(text.includes('欢迎使用'));
  assert.ok(text.includes('正文页'));
  assert.ok(text.includes('内容说明'));

  releaseOfficeCli();
  removeDir(work);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, readPptxSlides, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-merge 集成：把两个演示文稿按顺序合并为一个', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-merge-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const a = path.join(inputDir, 'a.pptx');
  const b = path.join(inputDir, 'b.pptx');
  await makePresentation(a, [{ title: 'A1', body: '正文A' }]);
  await makePresentation(b, [{ title: 'B1' }, { title: 'B2', body: '正文B' }]);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 120000 });
  const res = await runner.runTool('pptx-merge', { inputFiles: inputDir, output });

  assert.equal(res.ok, true);
  const slides = await readPptxSlides(output);
  assert.deepEqual(slides.map((s) => s.title), ['A1', 'B1', 'B2']);
  // 正文文本框也随幻灯片迁移
  assert.deepEqual(slides.map((s) => s.texts), [['正文A'], [], ['正文B']]);

  // 原文件不被修改
  const origB = await readPptxSlides(b);
  assert.deepEqual(origB.map((s) => s.title), ['B1', 'B2']);

  releaseOfficeCli();
  removeDir(work);
});

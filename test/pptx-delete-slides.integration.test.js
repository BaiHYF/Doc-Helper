const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, readPptxSlides, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-delete-slides 集成：删除指定序号幻灯片', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-delsl-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [
    { title: '一' },
    { title: '二' },
    { title: '三' },
    { title: '四' }
  ]);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-delete-slides', { inputFile: inputDir, slides: '2,4', output });

  assert.equal(res.ok, true);
  const slides = await readPptxSlides(output);
  assert.deepEqual(slides.map((s) => s.title), ['一', '三']);

  releaseOfficeCli();
  removeDir(work);
});

test('pptx-delete-slides 集成：范围删除', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-delsl2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [
    { title: '一' },
    { title: '二' },
    { title: '三' },
    { title: '四' }
  ]);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-delete-slides', { inputFile: inputDir, slides: '1-3', output });

  assert.equal(res.ok, true);
  const slides = await readPptxSlides(output);
  assert.deepEqual(slides.map((s) => s.title), ['四']);

  releaseOfficeCli();
  removeDir(work);
});

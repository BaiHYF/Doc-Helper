const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, readPptxSlides, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-find-replace 集成：替换全部幻灯片文本', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-findrep-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [
    { title: '年度报告', body: '公司年度报告发布' },
    { title: '结尾', body: '报告完毕' }
  ]);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-find-replace', { inputFile: inputDir, find: '报告', replace: '总结', output });

  assert.equal(res.ok, true);
  const slides = await readPptxSlides(output);
  assert.equal(slides[0].title, '年度总结');
  assert.ok(slides[0].texts.some((t) => t.includes('公司年度总结发布')));
  // 原文件未改动
  const orig = await readPptxSlides(input);
  assert.equal(orig[0].title, '年度报告');

  releaseOfficeCli();
  removeDir(work);
});

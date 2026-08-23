const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, readPptxSlides, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-add-slides 集成：末尾追加幻灯片', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-addsl-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [{ title: '原有页' }]);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-add-slides', {
    inputFile: inputDir,
    slidesText: '新页一\n新页二|新页二正文',
    output
  });

  assert.equal(res.ok, true);
  const slides = await readPptxSlides(output);
  assert.equal(slides.length, 3);
  assert.equal(slides[0].title, '原有页');
  assert.equal(slides[1].title, '新页一');
  assert.equal(slides[2].title, '新页二');
  assert.ok(slides[2].texts.some((t) => t.includes('新页二正文')));

  releaseOfficeCli();
  removeDir(work);
});

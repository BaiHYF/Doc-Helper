const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, exec, makePresentation, readPptxSlides, releaseOfficeCli, removeDir } = require('./helpers.js');

// 1x1 透明 PNG
const PNG_1PX = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000500010D0A2DB40000000049454E44AE426082',
  'hex'
);

test('pptx-add-image 集成：往第 1 张幻灯片插入图片', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-addimg-'));
  const inputDir = path.join(work, 'input');
  const imgDir = path.join(work, 'img');
  fs.mkdirSync(inputDir);
  fs.mkdirSync(imgDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [{ title: '封面', body: '标题页' }]);
  const img = path.join(imgDir, 'logo.png');
  fs.writeFileSync(img, PNG_1PX);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-add-image', {
    inputFile: inputDir,
    image: imgDir,
    slideIndex: '1',
    x: '2cm',
    y: '3cm',
    width: '5cm',
    output
  });

  assert.equal(res.ok, true);
  // 幻灯片数量与内容不变
  const slides = await readPptxSlides(output);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].title, '封面');
  // 幻灯片内确实存在图片
  const dump = JSON.parse(await exec(OFFICECLI, ['dump', output, '/slide[1]', '--json']));
  const hasPicture = dump.data.some((c) => c.type === 'picture' || (c.props && c.props.src));
  assert.equal(hasPicture, true);

  releaseOfficeCli();
  removeDir(work);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeDocx, readDocxTexts, releaseOfficeCli, removeDir } = require('./helpers.js');

test('docx-fill-template 集成：填充 {{key}} 占位符', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-filltmpl-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'template.docx');
  await makeDocx(input, ['通知：{{name}} 同学，请于 {{date}} 报到。', '签字：{{name}}']);

  const output = path.join(work, 'out.docx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('docx-fill-template', {
    inputFile: inputDir,
    data: JSON.stringify({ name: '张三', date: '2026-09-01' }),
    output
  });

  assert.equal(res.ok, true);
  const texts = await readDocxTexts(output);
  assert.ok(texts.some((t) => t.includes('通知：张三 同学')));
  assert.ok(texts.some((t) => t.includes('2026-09-01')));
  assert.ok(texts.some((t) => t.includes('签字：张三')));
  assert.ok(!texts.some((t) => t.includes('{{'))); // 无残留占位符

  releaseOfficeCli();
  removeDir(work);
});

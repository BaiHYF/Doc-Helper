const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeDocx, readDocxTexts, releaseOfficeCli, removeDir } = require('./helpers.js');

test('docx-delete-paragraphs 集成：删除包含关键词的段落', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-delpara-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.docx');
  await makeDocx(input, ['这是正文第一段', '【删除标记】这段要删', '正文继续', '【删除标记】这段也要删', '保留结尾']);

  const output = path.join(work, 'out.docx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('docx-delete-paragraphs', { inputFile: inputDir, keyword: '【删除标记】', output });

  assert.equal(res.ok, true);
  assert.equal(res.removed, 2);
  const texts = await readDocxTexts(output);
  assert.deepEqual(texts, ['这是正文第一段', '正文继续', '保留结尾']);
  // 原文件未改动
  const orig = await readDocxTexts(input);
  assert.equal(orig.length, 5);

  releaseOfficeCli();
  removeDir(work);
});

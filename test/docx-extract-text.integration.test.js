const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeDocx, releaseOfficeCli, removeDir } = require('./helpers.js');

test('docx-extract-text 集成：提取正文为纯文本', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-extract-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.docx');
  await makeDocx(input, ['第一段内容', '第二段内容', '表格段'], '页眉文字');

  const output = path.join(work, 'out.txt');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('docx-extract-text', { inputFile: inputDir, output });

  assert.equal(res.ok, true);
  const text = fs.readFileSync(output, 'utf8').replace(/^\uFEFF/, '');
  assert.ok(text.includes('第一段内容'));
  assert.ok(text.includes('第二段内容'));
  assert.ok(!text.includes('页眉文字')); // 不含页眉
  // 段落间以换行分隔
  assert.equal(text, '第一段内容\n第二段内容\n表格段');

  releaseOfficeCli();
  removeDir(work);
});

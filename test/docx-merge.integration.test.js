const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeDocx, readDocxTexts, releaseOfficeCli, removeDir } = require('./helpers.js');

test('docx-merge 集成：按顺序合并文档，保留段落样式与页眉', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-merge-docx-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const doc1 = path.join(inputDir, '第一章.docx');
  const doc2 = path.join(inputDir, '第二章.docx');

  await makeDocx(doc1, ['第一章标题', '第一章内容一', '第一章内容二'], '文档页眉');
  await makeDocx(doc2, ['第二章标题', '第二章内容']);

  const output = path.join(work, 'merged.docx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('docx-merge', { inputDir, output });

  assert.equal(res.ok, true);
  assert.deepEqual(res.outputFiles, [output]);
  assert.equal(res.paragraphs, 5);

  const texts = await readDocxTexts(output);
  assert.deepEqual(texts, ['第一章标题', '第一章内容一', '第一章内容二', '第二章标题', '第二章内容']);

  // 页眉沿用第一个文档
  const hdr = JSON.parse(await new Promise((resolve, reject) => {
    require('node:child_process').execFile(
      OFFICECLI, ['get', output, '/header', '--json'],
      { encoding: 'utf8', windowsHide: true },
      (err, stdout) => err ? reject(err) : resolve(stdout)
    );
  }));
  const headerText = hdr.data.results[0] && hdr.data.results[0].text;
  assert.equal(headerText, '文档页眉');

  releaseOfficeCli();
  removeDir(work);
});

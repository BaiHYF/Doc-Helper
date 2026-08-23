const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeDocx, readDocxTexts, releaseOfficeCli, removeDir } = require('./helpers.js');

test('docx-replace 集成：正文与表格关键词替换（子串、大小写敏感），不改原文件', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-replace-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const src = path.join(inputDir, '通知.docx');

  // 夹具：正文段落 + 表格内文本
  await makeDocx(src, ['关于 {{公司}} 的通知', '您好 {{name}}，请查收', '{{公司}} 年会'], '页眉：{{公司}}');
  // 添加一个含文本的表格
  const { exec, execBatch } = require('./helpers.js');
  await execBatch(OFFICECLI, src, [
    { command: 'add', parent: '/', type: 'table', props: { rows: 1, cols: 2 } },
    { command: 'add', parent: '/body/tbl[1]/tr[1]/tc[1]', type: 'paragraph', props: { text: '部门：{{公司}}' } },
    { command: 'add', parent: '/body/tbl[1]/tr[1]/tc[2]', type: 'paragraph', props: { text: '姓名：{{name}}' } }
  ]);
  await exec(OFFICECLI, ['save', src]);

  const outputDir = path.join(work, 'out');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('docx-replace', {
    inputDir,
    mapping: JSON.stringify({ '{{公司}}': '星辰科技', '{{name}}': '张三' }),
    outputDir
  });

  assert.equal(res.ok, true);
  assert.equal(res.outputFiles.length, 1);
  assert.ok(fs.existsSync(path.join(outputDir, '通知.docx')));

  // 原文件不被修改
  const origTexts = await readDocxTexts(src);
  assert.ok(origTexts.some((t) => t.includes('{{公司}}')));

  // 输出文件：正文已替换
  const outTexts = await readDocxTexts(path.join(outputDir, '通知.docx'));
  assert.ok(outTexts.some((t) => t.includes('关于 星辰科技 的通知')));
  assert.ok(outTexts.some((t) => t.includes('您好 张三，请查收')));
  assert.ok(outTexts.some((t) => t.includes('星辰科技 年会')));
  // 表格内文本也替换
  assert.ok(outTexts.some((t) => t.includes('部门：星辰科技')));
  assert.ok(outTexts.some((t) => t.includes('姓名：张三')));
  // 不残留占位符
  assert.ok(!outTexts.some((t) => t.includes('{{')));

  releaseOfficeCli();
  removeDir(work);
});

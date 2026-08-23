const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makePresentation, readPptxNotes, releaseOfficeCli, removeDir } = require('./helpers.js');

test('pptx-add-notes 集成：给每张幻灯片添加备注', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-pptx-addnotes-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'in.pptx');
  await makePresentation(input, [{ title: '一' }, { title: '二' }, { title: '三' }]);

  const output = path.join(work, 'out.pptx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('pptx-add-notes', {
    inputFile: inputDir,
    notesText: '备注A\n备注B',
    output
  });

  assert.equal(res.ok, true);
  const notes = await readPptxNotes(output);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].text, '备注A');
  assert.equal(notes[1].text, '备注B');

  releaseOfficeCli();
  removeDir(work);
});

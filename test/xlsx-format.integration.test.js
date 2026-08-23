const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, exec, execBatch, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-format 集成：表头样式 + 自动列宽 + 对齐 + 数字格式 + 冻结首行', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fmt-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const inputFile = path.join(inputDir, '表.xlsx');

  // 夹具：真实数字单元格（B 列为 Number 类型）
  await exec(OFFICECLI, ['create', inputFile]);
  await execBatch(OFFICECLI, inputFile, [
    { command: 'set', path: '/sheet[1]', props: { name: '数据' } },
    { command: 'add', parent: '/数据', type: 'cell', props: { ref: 'A1', value: '姓名' } },
    { command: 'add', parent: '/数据', type: 'cell', props: { ref: 'B1', value: '金额' } },
    { command: 'add', parent: '/数据', type: 'cell', props: { ref: 'A2', value: '张三' } },
    { command: 'add', parent: '/数据', type: 'cell', props: { ref: 'B2', value: '1234.5', type: 'number' } },
    { command: 'add', parent: '/数据', type: 'cell', props: { ref: 'A3', value: '李四' } },
    { command: 'add', parent: '/数据', type: 'cell', props: { ref: 'B3', value: '99', type: 'number' } }
  ]);
  await exec(OFFICECLI, ['save', inputFile]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-format', {
    inputFile: inputDir, output,
    autofit: '是', headerStyle: '是', align: 'center', numberFormat: '0.00', freezeRow: '1'
  });

  assert.equal(res.ok, true);
  assert.deepEqual(res.outputFiles, [output]);

  // 数据内容保留
  const cells = await readCells(output);
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['A2'], '张三');
  assert.equal(cells['B2'], '1234.5');

  // 表头样式：加粗 + 底色 + 居中
  const out = JSON.parse(await exec(OFFICECLI, ['get', output, '/数据', '--json']));
  const sheet = out.data.results[0];
  const cellA1 = findCell(sheet, 'A1');
  assert.equal(cellA1.format['font.bold'], true);
  assert.ok(cellA1.format.fill);
  assert.equal(cellA1.format['alignment.horizontal'], 'center');

  // 数字格式：B2 应用 0.00
  const cellB2 = findCell(sheet, 'B2');
  assert.equal(cellB2.format.numberformat, '0.00');

  // 冻结首行
  assert.equal(sheet.format.freeze, 'A2');

  releaseOfficeCli();
  removeDir(work);
});

function findCell(sheet, ref) {
  for (const row of sheet.children || []) {
    for (const cell of row.children || []) {
      if (String(cell.path || '').split(/[\\/]/).pop() === ref) return cell;
    }
  }
  return null;
}

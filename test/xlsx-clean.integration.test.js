const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');
const { OFFICECLI, TOOLS_ROOT, makeWorkbook, readCells, releaseOfficeCli, removeDir } = require('./helpers.js');

test('xlsx-clean 集成：姓名清洗预置模板（去空格 + 英文名首字母大写 + 出生年份去“年”）', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-clean-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const inputFile = path.join(inputDir, '人员数据.xlsx');

  await makeWorkbook(inputFile, '人员表', [
    ['姓名', '英文名', '出生年份', '备注'],
    [' 张三 ', '  john   smith  ', ' 1990年 ', '  hello  world  '],
    ['李四', 'alice   chen', '1995年', 'foo  bar'],
    ['王五', 'BOB', '2000', 'McDonald 公司']
  ]);

  const output = path.join(work, 'cleaned.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-clean', { inputFile: inputDir, output, preset: '姓名清洗' });

  assert.equal(res.ok, true);
  assert.deepEqual(res.outputFiles, [output]);
  assert.equal(res.rows, 3);

  const cells = await readCells(output);
  // 表头：只去空格
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['B1'], '英文名');
  assert.equal(cells['C1'], '出生年份');
  assert.equal(cells['D1'], '备注');
  // 数据行：去前后空格 + 英文名单空格 + 首字母大写 + 出生年份只留数字
  assert.equal(cells['A2'], '张三');
  assert.equal(cells['B2'], 'John Smith');
  assert.equal(cells['C2'], '1990');
  assert.equal(cells['D2'], 'hello  world'); // 非英文名列只去空格，不合并内部空格
  assert.equal(cells['A3'], '李四');
  assert.equal(cells['B3'], 'Alice Chen');
  assert.equal(cells['C3'], '1995');
  assert.equal(cells['D3'], 'foo  bar');
  assert.equal(cells['A4'], '王五');
  assert.equal(cells['B4'], 'BOB'); // 首字母大写，其余字母保持不变
  assert.equal(cells['C4'], '2000');
  assert.equal(cells['D4'], 'McDonald 公司');

  releaseOfficeCli();
  removeDir(work);
});

test('xlsx-clean 集成：通用选项（去重行/去空行/填充空值/数字转换/指定列统一大小写）', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-clean2-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);
  const inputFile = path.join(inputDir, '表.xlsx');

  await makeWorkbook(inputFile, '数据', [
    ['姓名', '英文名', '数量', '备注'],
    ['甲', '  alice  ', '12', ''],
    ['乙', '  bob  ', '12', 'x'],
    ['甲', '  alice  ', '12', ''],   // 整行重复
    ['', '', '', ''],                 // 全空行
    ['丙', ' carol  ', '3.5', 'y']
  ]);

  const output = path.join(work, 'out.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-clean', {
    inputFile: inputDir, output,
    trimCells: '是', removeDupRows: '是', removeEmptyRows: '是',
    titleCaseCol: '英文名', convertNums: '是', fillEmpty: '空'
  });

  assert.equal(res.ok, true);
  assert.equal(res.rows, 3); // 原 5 行数据 - 1 去重 - 1 空行 = 3

  const cells = await readCells(output);
  // 表头
  assert.equal(cells['A1'], '姓名');
  assert.equal(cells['B1'], '英文名');
  assert.equal(cells['C1'], '数量');
  assert.equal(cells['D1'], '备注');
  // 甲：去空格 + 英文名首字母大写 + 数量转数字 + 空备注填“空”
  assert.equal(cells['A2'], '甲');
  assert.equal(cells['B2'], 'Alice');
  assert.equal(cells['C2'], '12');
  assert.equal(cells['D2'], '空');
  // 乙：去空格 + 首字母大写
  assert.equal(cells['A3'], '乙');
  assert.equal(cells['B3'], 'Bob');
  assert.equal(cells['C3'], '12');
  assert.equal(cells['D3'], 'x');
  // 丙
  assert.equal(cells['A4'], '丙');
  assert.equal(cells['B4'], 'Carol');
  assert.equal(cells['C4'], '3.5');
  assert.equal(cells['D4'], 'y');

  releaseOfficeCli();
  removeDir(work);
});

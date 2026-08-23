// xlsx-transpose：把第一个工作表行列互换，输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('工作簿中没有工作表');
  const sheetName = sheet.preview || sheet.name || 'Sheet';

  const grid = sheetToGrid(sheet);
  if (!grid.length) throw new Error('工作表为空，无可转置内容');

  // 行列互换
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  const tgrid = [];
  for (let c = 0; c < cols; c++) {
    const row = [];
    for (let r = 0; r < rows; r++) row.push(grid[r][c]);
    tgrid.push(row);
  }

  ctx.progress('正在生成转置结果');
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheetName } }];
  tgrid.forEach((row, ri) => {
    row.forEach((value, ci) => {
      if (value == null || String(value) === '') return;
      cmds.push({
        command: 'add', parent: `/${sheetName}`, type: 'cell',
        props: { ref: `${colLetter(ci)}${ri + 1}`, value: String(value) }
      });
    });
  });
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已把 ${rows} 行 × ${cols} 列 转置为 ${cols} 行 × ${rows} 列`
  };
};

/** 把 sheet 读成二维数组（缺失单元格补 undefined，空字符串视为空） */
function sheetToGrid(sheet) {
  const grid = [];
  let maxRi = -1;
  for (const row of sheet.children || []) {
    if (row.type !== 'row') continue;
    for (const cell of row.children || []) {
      if (cell.type !== 'cell') continue;
      const ref = cell.preview || (cell.path ? path.basename(cell.path) : '');
      const m = /^([A-Z]+)(\d+)$/.exec(String(ref));
      if (!m) continue;
      const ci = colIndex(m[1]);
      const ri = Number(m[2]) - 1;
      maxRi = Math.max(maxRi, ri);
      const text = cell.text;
      if (text == null || String(text) === '') continue;
      if (!grid[ri]) grid[ri] = [];
      grid[ri][ci] = text;
    }
  }
  const out = [];
  for (let ri = 0; ri <= maxRi; ri++) out.push(grid[ri] || []);
  return out;
}

/** 列字母 → 0 基索引 */
function colIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 基列索引 → 列字母 */
function colLetter(i) {
  let s = '';
  i = i + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

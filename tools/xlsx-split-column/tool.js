// xlsx-split-column：把指定列按分隔符拆成多列，插入到原列右侧，输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const colArg = String(ctx.args.column || '').trim();
  if (!colArg) throw new Error('缺少列参数（列号或列名）');
  const sep = String(ctx.args.delimiter == null ? ',' : ctx.args.delimiter);

  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('工作簿中没有工作表');
  const sheetName = sheet.preview || sheet.name || 'Sheet';

  const grid = sheetToGrid(sheet);
  if (!grid.length) throw new Error('工作表为空');
  const header = grid[0].map((v) => (v == null ? '' : String(v)));

  const ci = resolveCol(colArg, header);
  if (ci < 0) throw new Error(`找不到列「${colArg}」（表头：${header.join('、') || '无'}）`);

  // 计算拆分最大段数，并预拆分每行
  let maxParts = 1;
  const partsByRow = grid.map((r) => {
    const v = r[ci] == null ? '' : String(r[ci]);
    const parts = v.split(sep);
    maxParts = Math.max(maxParts, parts.length);
    return parts;
  });

  // 生成新网格：原列左侧保留，原列写入拆分第 0 段，右侧插入其余拆分段，再顺延其余原列
  const outGrid = [];
  grid.forEach((r, ri) => {
    const parts = partsByRow[ri];
    const row = r.slice(0, ci + 1);                       // 原列及左侧
    row[ci] = parts[0] || '';                             // 原列 = 拆分第 0 段
    for (let p = 1; p < maxParts; p++) row.push(parts[p] || ''); // 其余拆分段
    for (let c = ci + 1; c < r.length; c++) row.push(r[c]);      // 原右侧列顺移
    outGrid.push(row);
  });

  // 表头：原列标题保留，新增列标题加后缀
  const outHeader = outGrid[0].map((v, c) => {
    if (c <= ci || v) return v;
    return header[ci] ? `${header[ci]}_${c - ci}` : colLetter(c);
  });
  outGrid[0] = outHeader;

  ctx.progress('正在生成拆分结果');
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheetName } }];
  outGrid.forEach((row, ri) => {
    row.forEach((value, cj) => {
      if (value == null || String(value) === '') return;
      cmds.push({
        command: 'add', parent: `/${sheetName}`, type: 'cell',
        props: { ref: `${colLetter(cj)}${ri + 1}`, value: String(value) }
      });
    });
  });
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已把列「${header[ci] || colLetter(ci)}」按 "${sep}" 拆分为 ${maxParts} 列`
  };
};

/** 解析列参数：数字（1 基）或表头列名 */
function resolveCol(arg, header) {
  if (/^\d+$/.test(arg)) {
    const n = parseInt(arg, 10);
    return n >= 1 && n <= header.length ? n - 1 : -1;
  }
  return header.indexOf(arg);
}

/** 把 sheet 读成二维数组（缺失单元格补 undefined） */
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

function colIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

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

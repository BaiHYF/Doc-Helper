// xlsx-merge-columns：把多个指定列合并为一列（用分隔符连接），写入第一列，输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const colsArg = String(ctx.args.columns || '').trim();
  if (!colsArg) throw new Error('缺少列参数（至少一列，多个用逗号分隔）');
  const sep = String(ctx.args.delimiter == null ? ' ' : ctx.args.delimiter);

  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('工作簿中没有工作表');
  const sheetName = sheet.preview || sheet.name || 'Sheet';

  const grid = sheetToGrid(sheet);
  if (!grid.length) throw new Error('工作表为空');
  const header = grid[0].map((v) => (v == null ? '' : String(v)));

  // 解析列列表（列号 1 基 或 表头列名）
  const colArgs = colsArg.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const colIdxs = colArgs.map((a) => resolveCol(a, header));
  if (colIdxs.some((c) => c < 0)) {
    throw new Error(`找不到列「${colArgs[colIdxs.indexOf(-1)]}」（表头：${header.join('、') || '无'}）`);
  }
  const target = colIdxs[0];

  // 合并各列值到第一列（表头也合并）
  const outGrid = grid.map((r, ri) => {
    const merged = colIdxs.map((c, i) => {
      const v = r[c];
      if (v == null || String(v) === '') return '';
      return String(v);
    }).join(sep);
    const row = [...r];
    row[target] = merged;
    // 清空被合并的其他列
    colIdxs.forEach((c) => { if (c !== target) row[c] = undefined; });
    return row;
  });
  // 表头：第一列标题改为各列标题连接
  outGrid[0][target] = colIdxs.map((c) => header[c] || colLetter(c)).join(sep);

  ctx.progress('正在生成合并结果');
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
    summary: `已把 ${colIdxs.length} 列合并为 1 列（${colArgs.join(' + ')}），分隔符 "${sep}"`
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

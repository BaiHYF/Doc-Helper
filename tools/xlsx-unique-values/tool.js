// xlsx-unique-values：从第一个工作表的指定列提取去重后的唯一值，输出为单列新表
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const colArg = String(ctx.args.column || '').trim();
  if (!colArg) throw new Error('缺少列参数（列号或列名）');

  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('工作簿中没有工作表');
  const sheetName = sheet.preview || sheet.name || 'Sheet';

  const grid = sheetToGrid(sheet);
  if (!grid.length) throw new Error('工作表为空');
  const header = grid[0].map((v) => (v == null ? '' : String(v)));

  // 定位目标列（列号 1 基 或 表头列名）
  const ci = resolveCol(colArg, header);
  if (ci < 0) throw new Error(`找不到列「${colArg}」（表头：${header.join('、') || '无'}）`);

  // 取该列值（跳过表头），保持首次出现顺序去重
  const seen = new Set();
  const values = [];
  for (let ri = 1; ri < grid.length; ri++) {
    const v = grid[ri][ci];
    if (v == null) continue;
    const key = String(v);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(key);
    }
  }

  ctx.progress('正在生成唯一值清单');
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheetName } }];
  cmds.push({
    command: 'add', parent: `/${sheetName}`, type: 'cell',
    props: { ref: 'A1', value: header[ci] || '值' }
  });
  values.forEach((v, i) => {
    cmds.push({
      command: 'add', parent: `/${sheetName}`, type: 'cell',
      props: { ref: `A${i + 2}`, value: v }
    });
  });
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已从列「${header[ci] || colLetter(ci)}」提取 ${values.length} 个唯一值（共 ${grid.length - 1} 行）`,
    uniqueCount: values.length
  };
};

/** 解析列参数：数字（1 基）或表头列名；返回 0 基索引，找不到返回 -1 */
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

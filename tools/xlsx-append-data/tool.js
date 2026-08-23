// xlsx-append-data：把多个同结构 xlsx 纵向拼接成一张表（表头按列名对齐，列取并集，缺失列留空，可选去重）
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const sources = (ctx.args.inputDir || [])
    .filter((f) => String(f).toLowerCase().endsWith('.xlsx'))
    .sort(compareNames);
  if (sources.length < 2) throw new Error('请至少上传 2 个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const dedupe = /^(是|yes|true)$/i.test(String(ctx.args.dedupe || '').trim());

  // 1. 读取所有源文件第一个工作表 → 二维数组 grid（值或 null）
  const grids = [];
  const usedCols = []; // 表头列名并集（保持出现顺序）
  for (const src of sources) {
    ctx.progress('正在读取 ' + path.basename(src));
    const doc = await ctx.run(['get', src, '/', '--json']);
    const sheet = firstSheet(doc);
    if (!sheet) throw new Error('源文件没有工作表: ' + path.basename(src));
    const grid = sheetToGrid(sheet);
    grids.push({ file: src, grid });
    for (const h of grid[0] || []) {
      const name = h == null ? '' : String(h);
      if (name && !usedCols.includes(name)) usedCols.push(name);
    }
  }
  if (!usedCols.length) throw new Error('所有文件的首行都没有表头内容');

  // 2. 拼接数据行（按列名对齐）
  const rows = [usedCols.slice()];
  const seen = new Set();
  let dupRemoved = 0;
  for (const { file, grid } of grids) {
    ctx.progress('正在拼接 ' + path.basename(file));
    const header = grid[0] || [];
    const colMap = {};
    header.forEach((h, i) => { if (h != null && String(h) !== '') colMap[String(h)] = i; });
    for (let ri = 1; ri < grid.length; ri++) {
      const srcRow = grid[ri];
      const outRow = usedCols.map((c) => {
        const si = colMap[c];
        return si !== undefined ? (srcRow[si] == null ? null : srcRow[si]) : null;
      });
      if (dedupe) {
        const key = outRow.map((v) => (v == null ? '' : String(v))).join('\u0001');
        if (seen.has(key)) { dupRemoved++; continue; }
        seen.add(key);
      }
      rows.push(outRow);
    }
  }

  // 3. 写入输出工作簿
  ctx.progress('正在生成输出文件');
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: '拼接结果' } }];
  rows.forEach((row, ri) => {
    row.forEach((value, ci) => {
      if (value == null || String(value) === '') return;
      const props = { ref: colLetter(ci + 1) + (ri + 1), value: String(value) };
      if (typeof value === 'number') props.type = 'number';
      else if (typeof value === 'boolean') props.type = 'boolean';
      cmds.push({ command: 'add', parent: '/sheet[1]', type: 'cell', props });
    });
  });
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  const dataRows = rows.length - 1;
  return {
    outputFiles: [output],
    summary: `已拼接 ${sources.length} 个文件 → ${dataRows} 行数据、${usedCols.length} 列` +
      (dedupe ? `（按整行去重 ${dupRemoved} 行）` : ''),
    rows: dataRows,
    columns: usedCols,
    removedDuplicates: dupRemoved
  };
};

/** 取工作簿根下第一个工作表 */
function firstSheet(doc) {
  const results = (doc && doc.data && doc.data.results) || [];
  const root = results[0];
  if (!root || !Array.isArray(root.children)) return null;
  return root.children.find((c) => c.type === 'sheet') || null;
}

/** sheet → 二维数组；值优先保持类型，空单元格为 null */
function sheetToGrid(sheet) {
  const grid = [];
  for (const row of sheet.children || []) {
    if (row.type !== 'row') continue;
    for (const cell of row.children || []) {
      if (cell.type !== 'cell') continue;
      const ref = cell.preview || (cell.path ? path.basename(cell.path) : '');
      const m = /^([A-Z]+)(\d+)$/.exec(String(ref));
      if (!m) continue;
      const ci = colIndex(m[1]);
      const ri = Number(m[2]) - 1;
      const val = cell.text;
      if (val == null || String(val) === '') continue;
      if (!grid[ri]) grid[ri] = [];
      grid[ri][ci] = inferValue(cell);
    }
  }
  return grid.map((r) => r || []);
}

/** 按 cell 格式类型推断值类型 */
function inferValue(cell) {
  const text = String(cell.text);
  const ft = cell.format && cell.format.type;
  if (ft === 'Number' && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (ft === 'Boolean') return text === 'true' || text === 'TRUE';
  return text;
}

/** 列字母 → 0 基索引（A→0, B→1 … AA→26） */
function colIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 1 基列号 → 列字母（1→A, 27→AA） */
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 中文数字字符 → 数值（用于文件名排序，如一、二、三…） */
const CN_NUM = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 提取文件名前导中文数字：如「二」→ {n:2, rest:''}，「十五」→ {n:15, rest:''} */
function cnNumPrefix(name) {
  let n = 0;
  let i = 0;
  while (i < name.length && CN_NUM[name[i]] !== undefined) {
    n = n * 10 + CN_NUM[name[i]];
    i++;
  }
  return i > 0 ? { n, rest: name.slice(i) } : null;
}

/** 文件名自然排序：前导中文数字按数值比，其余按数字感知的拼音/Unicode 比较 */
function compareNames(a, b) {
  const ca = cnNumPrefix(path.basename(a));
  const cb = cnNumPrefix(path.basename(b));
  if (ca && cb) {
    if (ca.n !== cb.n) return ca.n - cb.n;
    return ca.rest.localeCompare(cb.rest, 'zh', { numeric: true });
  }
  if (ca) return -1;
  if (cb) return 1;
  return path.basename(a).localeCompare(path.basename(b), 'zh', { numeric: true });
}

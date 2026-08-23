// xlsx-clean：通用数据清洗 —— 去重行/去空行/去首尾空格/指定列统一大小写/填充空值/数字转换；支持“姓名清洗”预置模板
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  const yes = (v) => /^(是|yes|true)$/i.test(String(v || '').trim());
  const preset = String(ctx.args.preset || '').trim();
  const presetNameClean = preset === '姓名清洗';
  const trimCells = yes(ctx.args.trimCells) || presetNameClean;
  const removeEmptyRows = yes(ctx.args.removeEmptyRows);
  const removeDupRows = yes(ctx.args.removeDupRows);
  const convertNums = yes(ctx.args.convertNums);
  const fillEmpty = String(ctx.args.fillEmpty || '').trim();
  const titleCaseCols = presetNameClean
    ? null // null = 自动识别（姓名清洗）
    : String(ctx.args.titleCaseCol || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);

  // 1. 读取第一个工作表 → grid + 表头
  ctx.progress('正在读取表格');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('文件中没有工作表');
  const grid = sheetToGrid(sheet);

  // 2. 定位列
  const header = grid[0] || [];
  const colIndexByName = {};
  header.forEach((h, i) => { if (h != null && String(h) !== '') colIndexByName[String(h)] = i; });

  // 姓名清洗预置：自动识别英文名列 / 出生年份列
  let nameColIdx = -1;
  let birthColIdx = -1;
  if (presetNameClean) {
    for (const [name, idx] of Object.entries(colIndexByName)) {
      const low = name.toLowerCase();
      if (low.includes('英文名') || low.includes('name')) nameColIdx = idx;
      if (low.includes('出生年') || low.includes('birth')) birthColIdx = idx;
    }
  }

  // 3. 逐单元格清洗（先结构清洗，再判断空行，最后填充空值）
  let changed = 0;
  let emptyRows = 0;
  const rows = [];
  const seen = new Set();
  for (let ri = 0; ri < grid.length; ri++) {
    const src = grid[ri];
    const row = src.map((v, ci) => cleanValue(v, ci, ri));
    // 补齐到表头列数（sheetToGrid 会跳过空单元格，缺失列在此补为 null）
    while (row.length < header.length) row.push(null);
    // 去空行：除表头外，清洗后（填充前）全空则跳过
    if (removeEmptyRows && ri > 0 && row.every((v) => v == null || String(v).trim() === '')) {
      emptyRows++;
      continue;
    }
    // 填充空值
    if (fillEmpty) {
      for (let ci = 0; ci < row.length; ci++) {
        if (row[ci] == null || String(row[ci]).trim() === '') {
          row[ci] = fillEmpty;
          changed++;
        }
      }
    }
    // 去重行：整行内容相同则跳过（保留首次）
    if (removeDupRows && ri > 0) {
      const key = row.map((v) => (v == null ? '' : String(v))).join('\u0001');
      if (seen.has(key)) continue;
      seen.add(key);
    }
    rows.push(row);
  }

  function cleanValue(value, ci, ri) {
    if (value == null) return value;
    const isHeader = ri === 0;
    let text = String(value);
    if (trimCells) text = text.trim();
    const applyTitleCase = presetNameClean
      ? (!isHeader && (ci === nameColIdx))
      : (!isHeader && titleCaseCols.includes(String(header[ci])));
    if (applyTitleCase) text = titleCaseWords(text);
    if (presetNameClean && !isHeader && ci === birthColIdx) text = text.replace(/年/g, '');
    if (text !== String(value)) changed++;
    if (convertNums && !isHeader && /^-?\d+(\.\d+)?$/.test(text)) {
      return { value: Number(text), numeric: true };
    }
    return text;
  }

  // 4. 写入输出
  ctx.progress('正在生成清洗结果');
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: '清洗结果' } }];
  rows.forEach((row, ri) => {
    row.forEach((value, ci) => {
      if (value == null) return;
      const text = typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
      const isNumeric = typeof value === 'object' && value !== null && value.numeric;
      if (String(text) === '' && !isNumeric) return;
      const props = { ref: colLetter(ci + 1) + (ri + 1), value: String(text) };
      if (isNumeric) props.type = 'number';
      else if (value === true || value === false) props.type = 'boolean';
      cmds.push({ command: 'add', parent: '/sheet[1]', type: 'cell', props });
    });
  });
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  const dataRows = Math.max(0, rows.length - 1);
  return {
    outputFiles: [output],
    summary: `清洗完成：${dataRows} 行数据（去空行 ${emptyRows} 行，变更单元格 ${changed} 个）` +
      (presetNameClean ? '，已应用「姓名清洗」模板' : ''),
    rows: dataRows,
    cellsChanged: changed,
    emptyRowsRemoved: emptyRows
  };
};

/** sheet → 二维数组（值或 null，保持类型；空行以空数组占位，不留空洞） */
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
      grid[ri][ci] = inferValue(cell);
    }
  }
  const out = [];
  for (let ri = 0; ri <= maxRi; ri++) out.push(grid[ri] || []);
  return out;
}

/** 按 cell 格式类型推断值类型 */
function inferValue(cell) {
  const text = String(cell.text);
  const ft = cell.format && cell.format.type;
  if (ft === 'Number' && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (ft === 'Boolean') return text === 'true' || text === 'TRUE';
  return text;
}

/** 英文首字母大写 + 词间单空格（保持其余字符原样） */
function titleCaseWords(text) {
  return String(text)
    .split(/\s+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** 列字母 → 0 基索引 */
function colIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 1 基列号 → 列字母 */
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

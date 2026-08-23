// xlsx-merge-sheets：把 inputDir 下多个 xlsx 合并为一个工作簿，每个源文件对应一个工作表
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const sources = (ctx.args.inputDir || [])
    .filter((f) => String(f).toLowerCase().endsWith('.xlsx'))
    .sort();
  if (!sources.length) throw new Error('inputDir 中没有 xlsx 文件');

  const output = ctx.output;
  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);

  const createdSheets = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    ctx.progress('正在处理 ' + path.basename(src));

    // 读取源文件第一个 sheet 的单元格
    const doc = await ctx.run(['get', src, '/', '--json']);
    const results = (doc && doc.data && doc.data.results) || [];
    const firstSheet = results[0] && Array.isArray(results[0].children)
      ? results[0].children.find((c) => c.type === 'sheet')
      : null;
    if (!firstSheet) throw new Error('源文件没有工作表: ' + path.basename(src));

    const sheetName = safeSheetName(path.basename(src, path.extname(src)));
    const batch = [];
    if (i === 0) {
      // 首个 sheet 复用 create 生成的默认 sheet
      batch.push({ command: 'set', path: '/sheet[1]', props: { name: sheetName } });
    } else {
      batch.push({ command: 'add', parent: '/', type: 'sheet', props: { name: sheetName } });
    }

    for (const row of firstSheet.children || []) {
      for (const cell of row.children || []) {
        const text = cell.text != null ? String(cell.text) : '';
        if (!text) continue;
        const props = { ref: path.basename(cell.path || ''), value: text };
        const ft = cell.format && cell.format.type;
        if (ft === 'String') props.type = 'string';
        else if (ft === 'Number') props.type = 'number';
        else if (ft === 'Boolean') props.type = 'boolean';
        batch.push({ command: 'add', parent: '/' + sheetName, type: 'cell', props });
      }
    }

    if (batch.length > 1) await ctx.batch(output, batch);
    createdSheets.push(sheetName);
  }

  // 落盘并释放文件
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return { outputFiles: [output], summary: `已合并 ${sources.length} 个文件`, sheets: createdSheets };
};

/** 源文件名 → 合法 sheet 名（≤31 字符，去除 Excel 非法字符） */
function safeSheetName(base) {
  let s = base.replace(/[\\/?*[\]:]/g, '_');
  if (s.length > 31) s = s.slice(0, 31);
  if (!s.trim()) s = 'Sheet';
  return s;
}

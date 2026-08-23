// xlsx-split：把一个工作簿拆成多个独立 xlsx，每个工作表保存为一个文件（文件名 = 工作表名）
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const outDir = ctx.args.outputDir || ctx.output;
  if (!outDir) throw new Error('缺少输出目录参数');
  fs.mkdirSync(outDir, { recursive: true });

  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheets = (root && root.children || []).filter((c) => c.type === 'sheet');
  if (!sheets.length) throw new Error('工作簿中没有工作表');

  const outputFiles = [];
  const names = [];
  for (const sheet of sheets) {
    const sheetName = safeSheetName(sheet.preview || sheet.name || 'Sheet');
    ctx.progress('正在拆分工作表「' + sheetName + '」');
    let out = path.join(outDir, sheetName + '.xlsx');
    let n = 2;
    while (fs.existsSync(out)) out = path.join(outDir, `${sheetName}(${n++}).xlsx`);
    if (fs.existsSync(out)) fs.unlinkSync(out);
    await ctx.run(['create', out]);

    const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheetName } }];
    for (const row of sheet.children || []) {
      if (row.type !== 'row') continue;
      for (const cell of row.children || []) {
        if (cell.type !== 'cell') continue;
        const text = cell.text != null ? String(cell.text) : '';
        if (!text) continue;
        const props = { ref: path.basename(cell.path || ''), value: text };
        const ft = cell.format && cell.format.type;
        if (ft === 'Number') { const num = Number(text); if (!Number.isNaN(num)) props.type = 'number'; }
        else if (ft === 'Boolean') props.type = 'boolean';
        cmds.push({ command: 'add', parent: '/sheet[1]', type: 'cell', props });
      }
    }
    await ctx.batch(out, cmds);
    await ctx.run(['save', out]);
    await ctx.run(['close', out]);
    outputFiles.push(out);
    names.push(sheetName);
  }

  return {
    outputFiles,
    summary: `已把工作簿拆分为 ${sheets.length} 个独立文件`,
    sheets: names
  };
};

/** 工作表名 → 合法名称（≤31 字符，去除 Excel 非法字符） */
function safeSheetName(base) {
  let s = String(base).replace(/[\\/?*[\]:]/g, '_').trim();
  if (!s) s = 'Sheet';
  if (s.length > 31) s = s.slice(0, 31);
  return s;
}

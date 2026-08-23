// xlsx-format：批量格式调整 —— 自动列宽 / 表头加粗+底色 / 水平对齐 / 数字格式 / 冻结首行（作用于所有工作表）
const fs = require('node:fs');
const path = require('node:path');

const HEADER_FILL = 'FFD9E2F3'; // 浅蓝表头底色

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  const autofit = /^(是|yes|true)$/i.test(String(ctx.args.autofit || '').trim()) ||
    String(ctx.args.autofit || '').trim() === '';
  const headerStyle = /^(是|yes|true)$/i.test(String(ctx.args.headerStyle || '').trim()) ||
    String(ctx.args.headerStyle || '').trim() === '';
  const align = String(ctx.args.align || '').trim().toLowerCase();
  const numberFormat = String(ctx.args.numberFormat || '').trim();
  const freezeRow = parseInt(String(ctx.args.freezeRow || '').trim(), 10);

  // 1. 读取工作簿全部工作表与单元格
  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheets = (root && root.children || []).filter((c) => c.type === 'sheet');
  if (!sheets.length) throw new Error('工作簿中没有工作表');

  // 2. 备份源文件到输出路径，再在副本上修改（保持原文件不动）
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  let styledSheets = 0;
  for (const sheet of sheets) {
    const sheetName = sheet.preview || sheet.name || 'Sheet';
    ctx.progress('正在格式化工作表「' + sheetName + '」');
    const cmds = [];
    let maxCol = 0;
    const colLen = {}; // 列 → 最大文本长度

    // 收集单元格信息
    const cells = [];
    for (const row of sheet.children || []) {
      if (row.type !== 'row') continue;
      for (const cell of row.children || []) {
        if (cell.type !== 'cell') continue;
        const ref = cell.preview || (cell.path ? path.basename(cell.path) : '');
        const m = /^([A-Z]+)(\d+)$/.exec(String(ref));
        if (!m) continue;
        const ci = colIndex(m[1]);
        const ri = Number(m[2]);
        maxCol = Math.max(maxCol, ci);
        const text = cell.text != null ? String(cell.text) : '';
        colLen[ci] = Math.max(colLen[ci] || 0, displayLen(text));
        cells.push({ ref, ci, ri, cell, text });
      }
    }
    if (!cells.length) continue;

    // 表头样式（首行加粗 + 底色 + 居中）
    if (headerStyle) {
      for (const c of cells) {
        if (c.ri !== 1) continue;
        const props = { bold: true, fill: HEADER_FILL, align: align || 'center' };
        cmds.push({ command: 'set', path: `/${sheetName}/${c.ref}`, props });
      }
    }

    // 水平对齐（作用于全部单元格）
    if (align === 'left' || align === 'center' || align === 'right') {
      for (const c of cells) {
        if (headerStyle && c.ri === 1) continue; // 表头已设
        cmds.push({ command: 'set', path: `/${sheetName}/${c.ref}`, props: { align } });
      }
    }

    // 数字格式（仅数字单元格）
    if (numberFormat) {
      for (const c of cells) {
        if (!c.cell.format || c.cell.format.type !== 'Number') continue;
        cmds.push({ command: 'set', path: `/${sheetName}/${c.ref}`, props: { numberformat: numberFormat } });
      }
    }

    // 自动列宽（按内容最大长度估算）
    if (autofit) {
      for (let ci = 1; ci <= maxCol; ci++) {
        const len = colLen[ci] || 8;
        cmds.push({ command: 'set', path: `/${sheetName}/col[${ci}]`, props: { width: clampWidth(len) } });
      }
    }

    // 冻结行
    if (Number.isFinite(freezeRow) && freezeRow > 0) {
      cmds.push({ command: 'set', path: `/${sheetName}`, props: { freeze: 'A' + (freezeRow + 1) } });
    }

    if (cmds.length) {
      await ctx.batch(output, cmds);
      styledSheets++;
    }
  }

  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已对 ${styledSheets}/${sheets.length} 个工作表应用格式` +
      (headerStyle ? '（表头加粗+底色）' : '') + (autofit ? '（自动列宽）' : '') +
      (align ? `（对齐 ${align}）` : '') + (numberFormat ? `（数字格式 ${numberFormat}）` : '') +
      (Number.isFinite(freezeRow) && freezeRow > 0 ? `（冻结前 ${freezeRow} 行）` : '')
  };
};

/** 列字母 → 0 基索引 */
function colIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 显示长度估算：中文按 2 字符宽计 */
function displayLen(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.charCodeAt(0) > 255 ? 2 : 1;
  return n;
}

/** 列宽：按内容长度 + 2 余量，下限 8、上限 50 */
function clampWidth(len) {
  return Math.min(50, Math.max(8, len + 2));
}

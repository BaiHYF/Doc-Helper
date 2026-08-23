// xlsx-find-replace：在第一个工作表中查找文本并替换（子串替换，可选手大小写敏感），输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 xlsx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const find = String(ctx.args.find || '');
  if (!find) throw new Error('缺少要查找的文本');
  const replace = String(ctx.args.replace == null ? '' : ctx.args.replace);
  const matchCase = /^(是|yes|true)$/i.test(String(ctx.args.matchCase || '').trim());

  ctx.progress('正在读取工作簿');
  const doc = await ctx.run(['get', input, '/', '--json']);
  const root = (doc && doc.data && doc.data.results && doc.data.results[0]) || null;
  const sheet = (root && root.children || []).find((c) => c.type === 'sheet');
  if (!sheet) throw new Error('工作簿中没有工作表');
  const sheetName = sheet.preview || sheet.name || 'Sheet';

  // 复制源文件到输出路径，再在副本上替换（不改原文件）
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  const cmds = [];
  for (const row of sheet.children || []) {
    if (row.type !== 'row') continue;
    for (const cell of row.children || []) {
      if (cell.type !== 'cell') continue;
      const text = cell.text == null ? '' : String(cell.text);
      const hit = matchCase ? text.includes(find) : text.toLowerCase().includes(find.toLowerCase());
      if (!hit) continue;
      const ref = cell.preview || (cell.path ? path.basename(cell.path) : '');
      if (!ref) continue;
      const next = matchCase ? text.split(find).join(replace) : replaceCI(text, find, replace);
      if (next === text) continue;
      cmds.push({ command: 'set', path: `/${sheetName}/${ref}`, props: { value: next } });
    }
  }

  if (cmds.length) {
    await ctx.batch(output, cmds);
    await ctx.run(['save', output]);
  }
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已替换 ${cmds.length} 个单元格（${find} → ${replace}）`
  };
};

/** 大小写不敏感的子串替换（保持原串其余部分大小写） */
function replaceCI(text, find, replace) {
  const low = text.toLowerCase();
  const f = find.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const idx = low.indexOf(f, i);
    if (idx === -1) { out += text.slice(i); break; }
    out += text.slice(i, idx) + replace;
    i = idx + find.length;
  }
  return out;
}

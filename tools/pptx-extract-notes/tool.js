// pptx-extract-notes：把 pptx 全部幻灯片备注提取为 txt，每张幻灯片备注一组，空行分隔
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  ctx.progress('正在读取备注');
  const q = await ctx.run(['query', input, 'notes', '--json']);
  const notes = (q && q.data && q.data.results || []).filter((n) => n.type === 'notes');

  const text = notes
    .map((n) => String(n.text == null ? '' : n.text))
    .filter((t) => t !== '')
    .join('\n\n');

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, '\uFEFF' + text, 'utf8');

  return {
    outputFiles: [output],
    summary: `已提取 ${notes.length} 条幻灯片备注`,
    notes: notes.length
  };
};

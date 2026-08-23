// docx-extract-text：把 docx 正文（含表格内文本）提取为纯文本 txt，按段落分行
const fs = require('node:fs');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 docx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  ctx.progress('正在提取正文');
  const q = await ctx.run(['query', input, 'paragraph', '--json']);
  const paras = (q && q.data && q.data.results || []).filter((p) =>
    p.type === 'paragraph' && p.path && p.path.startsWith('/body/'));

  // 按段落拼接纯文本（保留段落间顺序），段内换行符统一为 \n
  const lines = paras.map((p) => String(p.text == null ? '' : p.text).replace(/\r?\n/g, '\n'));
  const text = lines.join('\n');

  fs.mkdirSync(require('node:path').dirname(output), { recursive: true });
  fs.writeFileSync(output, '\uFEFF' + text, 'utf8'); // 加 BOM，便于记事本识别中文

  return {
    outputFiles: [output],
    summary: `已提取 ${lines.length} 个段落的纯文本`,
    paragraphs: lines.length
  };
};

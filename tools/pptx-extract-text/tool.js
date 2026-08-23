// pptx-extract-text：把 pptx 全部幻灯片文本（标题+文本框）提取为 txt，每张幻灯片一组，空行分隔
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  ctx.progress('正在读取幻灯片');
  const q = await ctx.run(['query', input, 'slide', '--json']);
  const slides = (q && q.data && q.data.results || []).filter((s) => s.type === 'slide');

  const blocks = [];
  for (const s of slides) {
    const lines = [];
    if (s.preview) lines.push(String(s.preview)); // 标题
    // 收集该幻灯片内所有带文本的 shape（title 占位符与 textbox）
    for (const ch of s.children || []) {
      if ((ch.type === 'title' || ch.type === 'textbox') && ch.text != null && String(ch.text) !== '') {
        lines.push(String(ch.text));
      }
    }
    if (lines.length) blocks.push(lines.join('\n'));
  }
  const text = blocks.join('\n\n');

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, '\uFEFF' + text, 'utf8');

  return {
    outputFiles: [output],
    summary: `已提取 ${blocks.length} 张幻灯片的文本`,
    slides: blocks.length
  };
};

// pptx-add-slides：在现有演示文稿末尾追加新幻灯片，输出新文件不改原文件
const fs = require('node:fs');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const slidesText = String(ctx.args.slidesText || '').trim();
  if (!slidesText) throw new Error('缺少幻灯片内容（每行一张，格式：标题 或 标题|正文）');

  // 解析：每行一张幻灯片；用 | 分隔标题与正文
  const slides = slidesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const i = line.indexOf('|');
      if (i === -1) return { title: line, body: '' };
      return { title: line.slice(0, i).trim(), body: line.slice(i + 1).trim() };
    });
  if (!slides.length) throw new Error('没有可添加的幻灯片');

  // 复制原文件到输出，再追加
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  ctx.progress(`正在添加 ${slides.length} 张幻灯片`);
  const cmds = slides.map((s) => ({ command: 'add', parent: '/', type: 'slide', props: { title: s.title } }));
  await ctx.batch(output, cmds);

  // 追加正文文本框（需要先知道当前幻灯片总数）
  const q = await ctx.run(['query', output, 'slide', '--json']);
  const total = (q && q.data && q.data.results || []).filter((s) => s.type === 'slide').length;
  const bodyCmds = [];
  slides.forEach((s, i) => {
    const idx = total - slides.length + i + 1; // 新增的幻灯片序号
    if (s.body) {
      bodyCmds.push({
        command: 'add', parent: `/slide[${idx}]`, type: 'textbox',
        props: { text: s.body, x: '2cm', y: '4cm', width: '20cm', height: '8cm' }
      });
    }
  });
  if (bodyCmds.length) await ctx.batch(output, bodyCmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已追加 ${slides.length} 张幻灯片（${slides.map((s) => s.title).join('、')}）`
  };
};

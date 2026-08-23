// pptx-delete-slides：删除指定序号的幻灯片，输出新文件不改原文件
const fs = require('node:fs');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const slidesArg = String(ctx.args.slides || '').trim();
  if (!slidesArg) throw new Error('缺少幻灯片序号参数');

  // 解析序号列表：逗号分隔 + 短横线范围
  const targets = new Set();
  for (const part of slidesArg.split(/[,，]/)) {
    const p = part.trim();
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (m) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) targets.add(i);
    } else if (/^\d+$/.test(p)) {
      targets.add(parseInt(p, 10));
    }
  }
  if (!targets.size) throw new Error('序号格式不正确（如 1,3,5 或 2-4）');

  ctx.progress('正在读取幻灯片');
  const q = await ctx.run(['query', input, 'slide', '--json']);
  const slides = (q && q.data && q.data.results || []).filter((s) => s.type === 'slide');

  // 校验序号不越界
  const total = slides.length;
  const toDelete = [...targets].filter((n) => n >= 1 && n <= total).sort((a, b) => b - a);
  if (!toDelete.length) throw new Error(`没有可删除的序号（当前共 ${total} 张幻灯片）`);

  // 复制原文件到输出，再删除（从后往前删，避免序号偏移）
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  ctx.progress(`正在删除 ${toDelete.length} 张幻灯片`);
  const cmds = toDelete.map((n) => ({ command: 'remove', path: `/slide[${n}]` }));
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已删除 ${toDelete.length} 张幻灯片（第 ${toDelete.slice().reverse().join('、')} 张），剩余 ${total - toDelete.length} 张`
  };
};

// pptx-add-notes：给每张幻灯片添加演讲备注，输出新文件不改原文件
const fs = require('node:fs');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const notesText = String(ctx.args.notesText || '');
  if (!notesText.trim()) throw new Error('缺少备注内容（每行一条，对应每张幻灯片）');

  // 解析：每行 = 一张幻灯片的备注
  const lines = notesText.split(/\r?\n/).map((l) => l.trim());
  // 移除末尾空行
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const notes = lines.filter((l) => l !== '');
  if (!notes.length) throw new Error('没有可添加的备注');

  // 复制原文件到输出
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  ctx.progress('正在读取幻灯片数量');
  const q = await ctx.run(['query', output, 'slide', '--json']);
  const total = (q && q.data && q.data.results || []).filter((s) => s.type === 'slide').length;
  if (total === 0) throw new Error('演示文稿没有幻灯片');

  // 备注行数多于幻灯片数时，只取前 total 条；按序号逐张添加
  const cmds = [];
  notes.slice(0, total).forEach((text, i) => {
    cmds.push({ command: 'add', parent: `/slide[${i + 1}]`, type: 'notes', props: { text } });
  });
  if (!cmds.length) throw new Error('没有可添加的备注');

  ctx.progress(`正在添加 ${cmds.length} 条备注`);
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  const applied = Math.min(notes.length, total);
  return {
    outputFiles: [output],
    summary: `已给前 ${applied} 张幻灯片添加备注${notes.length > total ? `（备注共 ${notes.length} 条，超出部分已忽略）` : ''}`
  };
};

// docx-delete-paragraphs：删除 docx 中包含关键词的段落（正文+表格内段落），输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 docx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const kw = String(ctx.args.keyword || '').trim();
  if (!kw) throw new Error('缺少关键词参数');
  const keywords = kw.split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!keywords.length) throw new Error('关键词不能为空');

  // 复制原文件到输出路径，再在副本上删除（不改原文件）
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  ctx.progress('正在扫描段落');
  const q = await ctx.run(['query', output, 'paragraph', '--json']);
  const paras = (q && q.data && q.data.results || []).filter((p) =>
    p.type === 'paragraph' && p.path && p.path.startsWith('/body/'));

  // 找出要删除的段落（含关键词；表格内路径也保留删除）
  const toRemove = [];
  for (const p of paras) {
    const text = String(p.text == null ? '' : p.text);
    const low = text.toLowerCase();
    if (keywords.some((k) => low.includes(k))) toRemove.push(p);
  }

  // 从后往前删除，避免路径索引偏移（按段落序号数值降序）
  toRemove.sort((a, b) => paraIndex(b.path) - paraIndex(a.path));
  if (toRemove.length) {
    ctx.progress(`正在删除 ${toRemove.length} 个段落`);
    const cmds = toRemove.map((p) => ({ command: 'remove', path: p.path }));
    await ctx.batch(output, cmds);
    await ctx.run(['save', output]);
  }
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已删除 ${toRemove.length} 个包含关键词的段落（正文+表格，不含页眉页脚）`,
    removed: toRemove.length
  };
};

/** 从段落路径（/body/p[N] 或含 tbl 的路径）提取最后一个段落序号；无则返回 0 */
function paraIndex(p) {
  const m = /p\[(\d+)\]/.exec(String(p));
  return m ? Number(m[1]) : 0;
}

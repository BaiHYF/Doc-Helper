// docx-replace：批量替换 docx 关键词（正文段落 + 表格内文本），子串替换、大小写敏感，输出到新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const sources = (ctx.args.inputDir || [])
    .filter((f) => String(f).toLowerCase().endsWith('.docx'))
    .sort();
  if (!sources.length) throw new Error('请至少上传 1 个 docx 文件');

  // 解析替换映射
  let mapping = {};
  try {
    mapping = JSON.parse(String(ctx.args.mapping || '{}'));
  } catch (_) {
    throw new Error('替换映射不是合法 JSON（应为 {"旧词":"新词",...}）');
  }
  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
    throw new Error('替换映射应为 JSON 对象（{"旧词":"新词",...}）');
  }
  const pairs = Object.entries(mapping).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
  if (!pairs.length) throw new Error('替换映射为空（至少需要一对 旧词→新词）');

  const outDir = ctx.args.outputDir || ctx.output;
  if (!outDir) throw new Error('缺少输出目录参数');
  fs.mkdirSync(outDir, { recursive: true });

  const outputFiles = [];
  let totalReplaced = 0;
  for (const src of sources) {
    const base = path.basename(src);
    ctx.progress('正在替换 ' + base);
    const out = path.join(outDir, base);
    // 复制原文件到输出路径（保留样式），再在副本上替换
    if (fs.existsSync(out)) fs.unlinkSync(out);
    fs.copyFileSync(src, out);

    // 读取全部段落（含表格内段落；query 返回正文 /body 及表格，过滤掉页眉页脚）
    const q = await ctx.run(['query', out, 'paragraph', '--json']);
    const paras = (q && q.data && q.data.results || []).filter((p) =>
      p.type === 'paragraph' && p.path && p.path.startsWith('/body/'));

    const cmds = [];
    let fileReplaced = 0;
    for (const p of paras) {
      const text = p.text == null ? '' : String(p.text);
      let next = text;
      for (const [from, to] of pairs) {
        if (!from) continue;
        next = next.split(from).join(to);
      }
      if (next === text) continue;
      // 段内换行符（\n）会拆成多个段落，写回时改为软换行（\v）保持结构
      cmds.push({ command: 'set', path: p.path, props: { text: next.replace(/\n/g, '\v') } });
      fileReplaced++;
    }

    if (cmds.length) {
      await ctx.batch(out, cmds);
      await ctx.run(['save', out]);
    }
    await ctx.run(['close', out]);
    totalReplaced += fileReplaced;
    outputFiles.push(out);
  }

  return {
    outputFiles,
    summary: `已处理 ${sources.length} 个文档，替换 ${totalReplaced} 处段落（正文+表格，不含页眉页脚）`,
    files: sources.length,
    paragraphsReplaced: totalReplaced
  };
};

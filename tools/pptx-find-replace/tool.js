// pptx-find-replace：在全部幻灯片的标题与文本框中查找并替换文本，输出新文件不改原文件
const fs = require('node:fs');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const find = String(ctx.args.find || '');
  if (!find) throw new Error('缺少要查找的文本');
  const replace = String(ctx.args.replace == null ? '' : ctx.args.replace);
  const matchCase = /^(是|yes|true)$/i.test(String(ctx.args.matchCase || '').trim());

  // 复制原文件到输出，再在副本上修改（不改原文件）
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  ctx.progress('正在扫描幻灯片文本');
  // query shape 同时覆盖标题占位符与文本框
  const q = await ctx.run(['query', output, 'shape', '--json']);
  const boxes = (q && q.data && q.data.results || []).filter((t) =>
    (t.type === 'textbox' || t.type === 'title' || t.type === 'shape') && t.path);

  const cmds = [];
  for (const tb of boxes) {
    const text = String(tb.text == null ? '' : tb.text);
    const hit = matchCase ? text.includes(find) : text.toLowerCase().includes(find.toLowerCase());
    if (!hit) continue;
    const next = matchCase ? text.split(find).join(replace) : replaceCI(text, find, replace);
    if (next === text) continue;
    // textbox 文本写入其第一个段落
    const pPath = `${tb.path}/paragraph[1]`;
    cmds.push({ command: 'set', path: pPath, props: { text: next } });
  }

  if (cmds.length) {
    await ctx.batch(output, cmds);
    await ctx.run(['save', output]);
  }
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已替换 ${cmds.length} 处文本（${find} → ${replace}）`
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

// docx-merge：把多个 docx 按顺序合并成一个，每个文档另起一页，保留段落基本样式（字体/字号/加粗/对齐），页眉页脚沿用第一个文档
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const sources = (ctx.args.inputDir || [])
    .filter((f) => String(f).toLowerCase().endsWith('.docx'))
    .sort();
  if (sources.length < 2) throw new Error('请至少上传 2 个 docx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  if (fs.existsSync(output)) fs.unlinkSync(output);
  await ctx.run(['create', output]);

  // 页眉页脚：沿用第一个文档（可能不存在，容错）
  let headerText = null;
  let footerText = null;
  try {
    const first = await ctx.run(['get', sources[0], '/header', '--json']);
    headerText = extractText(first);
  } catch (_) { /* 无页眉 */ }
  try {
    const firstFooter = await ctx.run(['get', sources[0], '/footer', '--json']);
    footerText = extractText(firstFooter);
  } catch (_) { /* 无页脚 */ }

  const cmds = [];
  if (headerText) cmds.push({ command: 'add', parent: '/', type: 'header', props: { text: headerText } });
  if (footerText) cmds.push({ command: 'add', parent: '/', type: 'footer', props: { text: footerText } });

  let paraCount = 0;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    ctx.progress('正在合并 ' + path.basename(src));
    const body = await ctx.run(['get', src, '/body', '--json']);
    const paras = (body && body.data && body.data.results[0] && body.data.results[0].children || [])
      .filter((c) => c.type === 'paragraph');

    let firstInDoc = true;
    for (const p of paras) {
      const text = p.text == null ? '' : String(p.text);
      const props = { text: text.replace(/\n/g, '\v') };
      copyStyle(p.format || {}, props);
      if (i > 0 && firstInDoc) { props.pageBreakBefore = true; firstInDoc = false; }
      cmds.push({ command: 'add', parent: '/', type: 'paragraph', props });
      paraCount++;
    }
  }

  ctx.progress('正在生成合并文档');
  await ctx.batch(output, cmds);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已合并 ${sources.length} 个文档 → ${paraCount} 段（每个文档另起一页；表格内容未合并）`,
    files: sources.length,
    paragraphs: paraCount
  };
};

/** 从 header/footer get 结果中提取文本 */
function extractText(doc) {
  const results = (doc && doc.data && doc.data.results) || [];
  const el = results[0];
  if (!el) return null;
  const text = el.text != null ? String(el.text).trim() : '';
  return text || null;
}

/** 复制段落基本样式：加粗 / 字号 / 字体 / 对齐 */
function copyStyle(fmt, props) {
  if (!fmt) return;
  if (fmt.bold === true) props.bold = true;
  if (fmt.size) {
    const pt = Number(String(fmt.size).replace(/pt$/i, ''));
    if (Number.isFinite(pt) && pt > 0) props.size = pt;
  }
  const font = fmt['font.latin'] || fmt['font.ea'] || fmt['font.ascii'];
  if (font) props.font = font;
  if (fmt.align) props.align = fmt.align;
}

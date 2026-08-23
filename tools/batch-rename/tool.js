// batch-rename：批量重命名上传的文件（前缀/后缀/查找替换/序号编号），输出到目录，不改原文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const files = (ctx.args.inputFiles || []).filter((f) => f);
  if (!files.length) throw new Error('请至少上传 1 个文件');
  const outDir = ctx.args.outputDir || ctx.output;
  if (!outDir) throw new Error('缺少输出目录参数');
  fs.mkdirSync(outDir, { recursive: true });

  const mode = String(ctx.args.mode || 'number').trim().toLowerCase();
  const prefix = String(ctx.args.prefix || '');
  const suffix = String(ctx.args.suffix || '');
  const find = String(ctx.args.find || '');
  const replace = String(ctx.args.replace || '');
  const start = parseInt(String(ctx.args.startNumber || '1').trim(), 10);
  const startNum = Number.isFinite(start) ? start : 1;

  const outputFiles = [];
  const renamed = [];
  files.forEach((f, i) => {
    const base = path.basename(f);
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    let newStem = stem;

    if (mode === 'prefix') {
      if (!prefix) throw new Error('mode=prefix 时需要填写前缀');
      newStem = prefix + stem;
    } else if (mode === 'suffix') {
      if (!suffix) throw new Error('mode=suffix 时需要填写后缀');
      newStem = stem + suffix;
    } else if (mode === 'replace') {
      if (!find) throw new Error('mode=replace 时需要填写要替换的片段');
      if (!stem.includes(find)) {
        throw new Error(`文件「${base}」文件名中找不到片段「${find}」`);
      }
      newStem = stem.split(find).join(replace);
    } else {
      // number：序号编号，保持扩展名，文件名变 序号.扩展名
      const n = String(startNum + i).padStart(Math.max(2, String(startNum + files.length - 1).length), '0');
      newStem = n;
    }

    const outName = newStem + ext;
    const out = path.join(outDir, outName);
    fs.copyFileSync(f, out);
    outputFiles.push(out);
    renamed.push({ from: base, to: outName });
  });

  return {
    outputFiles,
    summary: `已重命名 ${files.length} 个文件（${renamed.map((r) => `${r.from} → ${r.to}`).join('、')}）`,
    renamed
  };
};

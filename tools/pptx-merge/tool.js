// pptx-merge：把多个 pptx 演示文稿的幻灯片合并到第一个文件之后，输出新文件不改原文件
const fs = require('node:fs');

module.exports = async function (ctx) {
  const files = (ctx.args.inputFiles || []).filter((f) => f);
  if (!files.length) throw new Error('请至少上传 1 个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  // 复制第一个文件为输出（作为基底）
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(files[0], output);

  let added = 0;
  // 逐个合并其余文件
  for (const src of files.slice(1)) {
    const q = await ctx.run(['query', src, 'slide', '--json']);
    const slides = (q && q.data && q.data.results || []).filter((s) => s.type === 'slide');
    // 该源文件的起始目标序号（合并它之前的目标幻灯片数 + 1）
    const startBase = await countSlides(ctx, output) + 1;
    for (const s of slides) {
      const d = await ctx.run(['dump', src, s.path, '--json']);
      const cmds = (d && d.data || []).filter((c) => c.command !== 'meta');
      const remapped = cmds.map((c) => rewritePaths(c, startBase));
      await ctx.batch(output, remapped);
      added++;
    }
  }

  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已合并 ${files.length} 个演示文稿，共追加 ${added} 张幻灯片`
  };
};

/** 把 dump 命令中 /slide[N] 路径重映射为新序号 N+base-1，并去掉会冲突的 id/layout */
function rewritePaths(cmd, base) {
  const c = { ...cmd, props: cmd.props ? { ...cmd.props } : undefined };
  // 去除显式 id（避免 shapeTree id 冲突，让 officecli 自动分配）
  if (c.props && (c.props.id != null || c.props.allowDuplicate != null)) {
    delete c.props.id;
    delete c.props.allowDuplicate;
  }
  // add slide 时去掉 layout（目标文件的 layout 编号可能不同）
  if (c.command === 'add' && c.type === 'slide') {
    delete c.props.layout;
  }
  // 路径重映射
  if (c.path) c.path = remap(c.path, base);
  if (c.parent) c.parent = remap(c.parent, base);
  return c;
}

function remap(p, base) {
  return String(p).replace(/\/slide\[(\d+)\]/g, (_, n) => `/slide[${Number(n) + base - 1}]`);
}

/** 查询当前幻灯片数量 */
async function countSlides(ctx, file) {
  const q = await ctx.run(['query', file, 'slide', '--json']);
  return (q && q.data && q.data.results || []).filter((s) => s.type === 'slide').length;
}

// pptx-add-image：在指定幻灯片插入图片，输出新文件不改原文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 pptx 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const image = (ctx.args.image || [])[0];
  if (!image) throw new Error('请上传要插入的图片');
  const slideIndex = parseInt(String(ctx.args.slideIndex || '1').trim(), 10);
  const target = Number.isFinite(slideIndex) && slideIndex >= 1 ? slideIndex : 1;

  // 参数：位置（可省略，默认居中）；尺寸（可省略，默认保持原比例）
  const x = String(ctx.args.x || '').trim();
  const y = String(ctx.args.y || '').trim();
  const width = String(ctx.args.width || '').trim();
  const height = String(ctx.args.height || '').trim();

  // 复制原文件到输出
  if (fs.existsSync(output)) fs.unlinkSync(output);
  fs.copyFileSync(input, output);

  ctx.progress('正在读取幻灯片');
  const q = await ctx.run(['query', output, 'slide', '--json']);
  const total = (q && q.data && q.data.results || []).filter((s) => s.type === 'slide').length;
  if (!total) throw new Error('演示文稿没有幻灯片');
  if (target > total) throw new Error(`第 ${target} 张幻灯片不存在（当前共 ${total} 张）`);

  // 构造图片 props（支持绝对/相对定位、宽高）
  const props = { src: image };
  if (x) props.x = x;
  if (y) props.y = y;
  if (width) props.width = width;
  if (height) props.height = height;
  // 未指定位置时放中间
  if (!x && !y) { props.x = '0cm'; props.y = '4cm'; }

  ctx.progress(`正在向第 ${target} 张幻灯片插入图片`);
  await ctx.run(['add', output, `/slide[${target}]`, '--type', 'picture', ...toPropArgs(props)]);
  await ctx.run(['save', output]);
  await ctx.run(['close', output]);

  return {
    outputFiles: [output],
    summary: `已在第 ${target} 张幻灯片插入图片（${path.basename(image)}）`
  };
};

/** props 对象 → ['--prop','k=v',...] 参数 */
function toPropArgs(props) {
  const args = [];
  for (const [k, v] of Object.entries(props)) {
    args.push('--prop', `${k}=${v}`);
  }
  return args;
}

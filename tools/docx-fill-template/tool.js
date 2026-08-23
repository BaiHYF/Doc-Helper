// docx-fill-template：用 JSON 数据填充 docx 模板的 {{key}} 占位符（officecli merge 命令），不改原模板
const fs = require('node:fs');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个 docx 模板文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');
  const dataRaw = String(ctx.args.data || '').trim();
  if (!dataRaw) throw new Error('缺少填充数据（应为 JSON 对象，如 {"姓名":"张三"}）');

  // 校验数据为 JSON 对象
  let data;
  try {
    data = JSON.parse(dataRaw);
  } catch (_) {
    throw new Error('填充数据不是合法 JSON（应为 {"key":"value",...}）');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('填充数据应为 JSON 对象（{"key":"value",...}）');
  }

  // 输出文件已存在时先删除（merge 默认拒绝覆盖）
  if (fs.existsSync(output)) fs.unlinkSync(output);

  ctx.progress('正在填充模板');
  await ctx.run(['merge', input, output, '--data', dataRaw, '--force', '--json']);

  return {
    outputFiles: [output],
    summary: `已填充模板 ${Object.keys(data).length} 个占位符`
  };
};

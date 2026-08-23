// txt-merge：把多个 txt 文本文件按顺序合并为一个 txt，可指定分隔文本与编码
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const files = (ctx.args.inputFiles || []).filter((f) => f);
  if (!files.length) throw new Error('请至少上传 1 个 txt 文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  const separator = String(ctx.args.separator || '');
  const encoding = String(ctx.args.encoding || 'utf8').trim().toLowerCase();
  if (!['utf8', 'utf-8', 'gbk', 'gb18030', 'utf16le', 'utf-16le'].includes(encoding)) {
    throw new Error('不支持的编码（支持 utf8 / gbk / gb18030 / utf16le）');
  }
  const readEnc = encoding.startsWith('utf-16') ? 'utf16le' : encoding === 'gb18030' ? 'gb18030' : encoding === 'gbk' ? 'gbk' : 'utf8';

  const parts = [];
  let totalChars = 0;
  for (const f of files) {
    ctx.progress('正在合并 ' + path.basename(f));
    const buf = fs.readFileSync(f);
    // 去掉 BOM
    const noBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
      ? buf.subarray(3) : buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
        ? buf.subarray(2) : buf;
    let text;
    if (readEnc === 'gbk' || readEnc === 'gb18030') {
      text = new TextDecoder(readEnc === 'gbk' ? 'gbk' : 'gb18030').decode(noBom);
    } else {
      text = noBom.toString(readEnc === 'utf8' ? 'utf8' : 'utf16le');
    }
    parts.push(text);
    totalChars += text.length;
  }

  const merged = parts.join(separator);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, '\uFEFF' + merged, 'utf8'); // UTF-8 + BOM，便于记事本识别中文

  return {
    outputFiles: [output],
    summary: `已合并 ${files.length} 个文本文件，共 ${totalChars} 字符`
  };
};

// text-encoding：文本文件编码转换（utf8 / gbk / gb18030 / utf16le 互转，输出 utf8 或 utf16le），输出新文件
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (ctx) {
  const input = (ctx.args.inputFile || [])[0];
  if (!input) throw new Error('请上传一个文本文件');
  const output = ctx.output;
  if (!output) throw new Error('缺少输出路径参数');

  const from = String(ctx.args.from || 'auto').trim().toLowerCase();
  const to = String(ctx.args.to || 'utf8').trim().toLowerCase();

  const FROM_ENC = { utf8: 'utf8', 'utf-8': 'utf8', utf16le: 'utf16le', 'utf-16le': 'utf16le', gbk: 'gbk', gb18030: 'gb18030' };
  const TO_ENC = { utf8: 'utf8', 'utf-8': 'utf8', utf16le: 'utf16le', 'utf-16le': 'utf16le' };
  if (!(to in TO_ENC)) throw new Error('不支持的输出编码（支持 utf8 / utf16le）');

  ctx.progress('正在读取文件');
  const buf = fs.readFileSync(input);

  // 源编码：auto 时按 BOM 推断，否则按参数
  let fromEnc = from === 'auto' ? detectBom(buf) : (FROM_ENC[from] || null);
  if (!fromEnc) throw new Error('不支持的输入编码（支持 utf8 / gbk / gb18030 / utf16le / auto）');

  // 解码：GBK/GB18030 用 TextDecoder，其余用 Buffer
  let text;
  if (fromEnc === 'gbk' || fromEnc === 'gb18030') {
    text = new TextDecoder(fromEnc).decode(buf);
  } else {
    const b = stripBom(buf);
    text = b.toString(fromEnc === 'utf16le' ? 'utf16le' : 'utf8');
  }

  // 编码输出
  ctx.progress('正在生成转换结果');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let outBuf;
  if (to === 'utf16le') {
    outBuf = Buffer.from('\uFEFF' + text, 'utf16le'); // UTF-16LE + BOM
  } else {
    outBuf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]); // UTF-8 + BOM
  }
  fs.writeFileSync(output, outBuf);

  return {
    outputFiles: [output],
    summary: `已把文件从 ${fromEnc.toUpperCase()} 转换为 ${to.toUpperCase()}（${text.length} 字符）`
  };
};

/** 去掉 BOM */
function stripBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2);
  return buf;
}

/** 按 BOM 推断编码：utf8 / utf16le / gb18030（无 BOM 时默认 gbk） */
function detectBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf8';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf16le'; // BE 近似按 LE 处理（少见）
  return 'gbk'; // 无 BOM 默认按 GBK（中文 Windows 常见）
}

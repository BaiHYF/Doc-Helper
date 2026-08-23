/**
 * Node 工具固定运行器（由 toolRunner.js 以子进程方式调用，替代 PowerShell 胶水）。
 *
 * 调用方式：node nodeToolRunner.js <tool.js 绝对路径>
 * stdin 传入一行 JSON：{ "args": {...}, "officecli": "<exe 路径>" }
 *   - args 中 type:"file" 参数已由 toolRunner 解析为"绝对路径数组"
 *   - args 中 output:true 参数是输出文件路径字符串
 *
 * 契约：加载 tool.js 导出的 async 函数并执行，注入 ctx：
 *   - ctx.args     工具参数对象（键与 meta.json parameters.properties 对应）
 *   - ctx.output   输出文件路径（args.output，可能为 null）
 *   - ctx.officecli officecli.exe 绝对路径
 *   - ctx.run(argv)          执行 officecli 命令；输出含 JSON 则解析返回，否则返回原始字符串
 *   - ctx.batch(file, cmds)  执行 officecli batch（原子；命令数组写临时文件）
 *   - ctx.progress(msg)      上报进度（前端实时展示）
 * 成功：stdout 最后一行 {"ok":true,"outputFiles":[...],"summary":"..."}
 * 失败：stdout 最后一行 {"ok":false,"error":"..."}，退出码 1
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', run);

async function run() {
  let payload;
  try { payload = JSON.parse(stdin); } catch (_) { return fail('运行器入参不是合法 JSON'); }
  const toolPath = process.argv[2];
  if (!toolPath || !fs.existsSync(toolPath)) return fail('工具脚本不存在: ' + toolPath);
  const officecli = payload && payload.officecli;
  if (!officecli || !fs.existsSync(officecli)) return fail('officecli 未配置');

  const args = (payload && payload.args) || {};
  const ctx = {
    officecli,
    args,
    output: args.output != null ? args.output : null,
    run: (argv) => execOC(officecli, argv),
    batch: async (file, commands) => {
      const tmp = path.join(os.tmpdir(), 'dh-batch-' + Math.random().toString(36).slice(2) + '.json');
      fs.writeFileSync(tmp, JSON.stringify(commands));
      try {
        await execOC(officecli, ['batch', file, '--input', tmp]);
      } finally {
        fs.unlinkSync(tmp);
      }
    },
    progress: (msg) => process.stdout.write(JSON.stringify({ progress: msg }) + '\n')
  };

  try {
    delete require.cache[require.resolve(toolPath)];
    const fn = require(toolPath);
    if (typeof fn !== 'function') return fail('tool.js 未导出函数（module.exports = async (ctx) => {...}）');
    const result = await fn(ctx);
    if (!result || typeof result !== 'object') return fail('工具未返回对象结果（应 return { outputFiles, summary }）');
    const out = {
      ok: true,
      outputFiles: Array.isArray(result.outputFiles) ? result.outputFiles : [],
      summary: typeof result.summary === 'string' ? result.summary : ''
    };
    // 透传工具自定义的额外字段（如 sheets 列表），供前端/调用方使用
    for (const [k, v] of Object.entries(result)) {
      if (!(k in out)) out[k] = v;
    }
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  } catch (e) {
    return fail(e && e.message ? e.message : String(e));
  }
}

/** 执行 officecli：输出含 JSON 则解析返回，否则返回原始文本；非 0 退出码抛错 */
function execOC(officecli, argv) {
  return new Promise((resolve, reject) => {
    cp.execFile(officecli, argv, {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 120000
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || '').trim() || (stdout || '').trim() || err.message;
        reject(new Error(`officecli 失败: ${argv.join(' ')} → ${detail.slice(0, 300)}`));
        return;
      }
      let parsed = null;
      const text = String(stdout).trim();
      if (text) {
        try { parsed = JSON.parse(text); } catch (_) {
          // 多行 JSONL 或带前导噪音：逐行找以 { 开头的合法 JSON
          for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (!t.startsWith('{')) continue;
            try { parsed = JSON.parse(t); break; } catch (_2) { /* 继续找 */ }
          }
        }
      }
      resolve(parsed !== null ? parsed : stdout);
    });
  });
}

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(msg) }) + '\n');
  process.exit(1);
}

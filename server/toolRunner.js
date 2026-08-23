const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ToolRegistry } = require('./toolRegistry.js');

/**
 * 工具执行器。优先执行 tools/<name>/tool.js（Node 胶水，经 nodeToolRunner 子进程），
 * 兼容遗留的 tools/<name>/tool.ps1。
 * 契约：
 *  - Node：stdin 传 JSON（{args, officecli}），stdout 最后一行 JSON
 *  - PowerShell：命名参数（-key value），stdout 最后一行 JSON
 *  - 结果 JSON：{"ok":true,"outputFiles":[...],"summary":"..."}；失败退出码非 0 或 ok=false
 */
class ToolRunner {
  constructor({ toolsRoot, officecliPath, timeoutMs = 120000 }) {
    this.toolsRoot = toolsRoot;
    this.officecliPath = officecliPath;
    this.timeoutMs = timeoutMs;
    this.registry = new ToolRegistry(toolsRoot);
  }

  async runTool(name, args = {}, opts = {}) {
    const tool = this.registry.getTool(name);
    if (!tool) throw new Error(`工具不存在: ${name}`);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    const psFile = path.join(tool.dir, 'tool.ps1');
    const jsFile = path.join(tool.dir, 'tool.js');

    let cmd;
    let argv;
    let stdinPayload = null;
    if (fs.existsSync(jsFile)) {
      // Node 工具：tool.js 优先，参数经 stdin JSON 传入，type:"file" 参数解析为文件数组
      cmd = process.execPath;
      argv = [path.join(__dirname, 'nodeToolRunner.js'), jsFile];
      stdinPayload = JSON.stringify({ args: this.resolveFileParams(tool, args), officecli: this.officecliPath });
    } else if (fs.existsSync(psFile)) {
      // 遗留 PowerShell 工具
      cmd = 'powershell';
      argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile];
      for (const [key, value] of Object.entries(args || {})) {
        if (value === undefined || value === null) continue;
        argv.push(`-${key}`);
        argv.push(Array.isArray(value) ? JSON.stringify(value) : String(value));
      }
    } else {
      throw new Error(`工具缺少脚本文件: ${name}`);
    }
    const env = { ...process.env, OFFICECLI: this.officecliPath };

    return this.executeChild({ cmd, argv, stdinPayload, env, name, timeoutMs, onProgress, signal: opts.signal });
  }

  /** 把 type:"file" 参数（上传目录路径）解析为目录内文件的绝对路径数组 */
  resolveFileParams(tool, args) {
    const params = (tool.parameters && tool.parameters.properties) || {};
    const out = { ...args };
    for (const [key, prop] of Object.entries(params)) {
      if (!prop || prop.type !== 'file') continue;
      const dir = out[key];
      if (typeof dir !== 'string' || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      out[key] = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => path.join(dir, e.name));
    }
    return out;
  }

  executeChild({ cmd, argv, stdinPayload, env, name, timeoutMs, onProgress, signal }) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, argv, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;

      /** 实时解析 stdout：形如 {"progress":"..."} 的行作为进度回调 */
      const emitProgressLines = (chunk) => {
        if (!onProgress) return;
        for (const line of chunk.split(/\r?\n/)) {
          const t = line.trim();
          if (!t) continue;
          try {
            const parsed = JSON.parse(t);
            if (parsed && typeof parsed.progress === 'string' && parsed.progress) {
              onProgress(parsed.progress);
            }
          } catch (_) { /* 非 JSON 行忽略 */ }
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`工具执行超时（${timeoutMs}ms）: ${name}`));
      }, timeoutMs);

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error(`任务已取消: ${name}`));
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout.on('data', (d) => {
        stdout += d;
        emitProgressLines(d.toString('utf8'));
      });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`无法启动 ${cmd}: ${err.message}`));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let result = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed && typeof parsed === 'object') { result = parsed; break; }
          } catch (_) { /* 不是 JSON 的行跳过 */ }
        }
        if (code !== 0) {
          // Node runner 失败信息在 stdout 的 {"ok":false,"error":...}，PowerShell 失败信息在 stderr
          const msg = (result && result.ok === false && result.error)
            ? result.error
            : (stderr.trim() || `工具执行失败，退出码 ${code}: ${name}`);
          reject(new Error(msg));
          return;
        }
        if (!result) {
          reject(new Error(`无法解析工具输出: ${name} → ${stdout.slice(0, 200)}`));
          return;
        }
        if (result.ok === false) {
          reject(new Error(result.error || `工具返回失败: ${name}`));
          return;
        }
        resolve(result);
      });

      if (stdinPayload !== null) {
        child.stdin.write(stdinPayload);
      }
      child.stdin.end();
    });
  }
}

module.exports = { ToolRunner };

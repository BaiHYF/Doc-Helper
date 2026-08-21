const { spawn } = require('node:child_process');
const path = require('node:path');
const { ToolRegistry } = require('./toolRegistry.js');

/**
 * 工具执行器：以 powershell -File 执行 tools/<name>/tool.ps1。
 * 契约（见需求文档 §5.2）：
 *  - 输入走命名参数（-key value）
 *  - stdout 输出一个 JSON：{"ok":true,"outputFiles":[...],"summary":"..."}
 *  - 失败：退出码非 0，或 stdout JSON ok=false
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
    const script = path.join(tool.dir, 'tool.ps1');
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
    for (const [key, value] of Object.entries(args || {})) {
      if (value === undefined || value === null) continue;
      argv.push(`-${key}`);
      argv.push(Array.isArray(value) ? JSON.stringify(value) : String(value));
    }
    const env = { ...process.env, OFFICECLI: this.officecliPath };

    return new Promise((resolve, reject) => {
      const child = spawn('powershell', argv, { env, windowsHide: true });
      let stdout = '';
      let stderr = '';
      let settled = false;

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
      if (opts.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`无法启动 PowerShell: ${err.message}`));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `工具执行失败，退出码 ${code}: ${name}`));
          return;
        }
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let result = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed && typeof parsed === 'object') { result = parsed; break; }
          } catch (_) { /* 不是 JSON 的行跳过 */ }
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
    });
  }
}

module.exports = { ToolRunner };

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ToolRegistry } = require('./toolRegistry.js');
const { PluginRegistry } = require('./pluginRegistry.js');
const { ToolRunner } = require('./toolRunner.js');
const { FileStore } = require('./fileStore.js');
const { Agent } = require('./agent.js');
const config = require('./config.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const MAX_BODY = 500 * 1024 * 1024; // 允许大文件（base64 传输）

/** 纯 Node http 应用：静态托管 web/ + /api 路由 */
class DocHelperApp {
  constructor(options = {}) {
    this.root = options.root || config.ROOT;
    this.webRoot = options.webRoot || path.join(this.root, 'web');
    this.toolsRoot = options.toolsRoot || path.join(this.root, 'tools');
    this.officecliPath = options.officecliPath || config.OFFICECLI_PATH;
    this.timeoutMs = options.timeoutMs || 120000;

    this.registry = new ToolRegistry(this.toolsRoot);
    this.pluginRegistry = new PluginRegistry(
      path.join(this.webRoot, 'plugins'),
      path.join(this.root, 'server', 'runtime', 'plugins.json')
    );
    this.runner = new ToolRunner({
      toolsRoot: this.toolsRoot,
      officecliPath: this.officecliPath,
      timeoutMs: this.timeoutMs
    });
    this.fileStore = new FileStore(path.join(this.root, 'server', 'runtime'));
    this.tasks = new Map();
    this.httpServer = http.createServer((req, res) => this.handle(req, res));
  }

  listen(port) {
    return new Promise((resolve) => this.httpServer.listen(port, resolve));
  }

  close() {
    this.httpServer.close();
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/api/health') {
      return this.json(res, 200, { ok: true, officecli: fs.existsSync(this.officecliPath) });
    }
    if (method === 'GET' && pathname === '/api/tools') {
      return this.json(res, 200, { tools: this.registry.listTools() });
    }
    if (method === 'GET' && pathname === '/api/plugins') {
      return this.json(res, 200, { plugins: this.pluginRegistry.listPlugins() });
    }
    if (method === 'POST' && /^\/api\/plugins\/[^/]+\/enable$/.test(pathname)) {
      const file = pathname.split('/')[3];
      return this.readJson(req).then((body) => {
        const updated = this.pluginRegistry.setEnabled(file, Boolean(body.enabled));
        this.json(res, 200, { ok: true, plugin: updated });
      }).catch((e) => this.json(res, 400, { error: e.message }));
    }
    if (method === 'POST' && /^\/api\/plugins\/[^/]+\/delete$/.test(pathname)) {
      const file = pathname.split('/')[3];
      return this.readJson(req).then(() => {
        this.pluginRegistry.removePlugin(file);
        this.json(res, 200, { ok: true });
      }).catch((e) => this.json(res, 400, { error: e.message }));
    }
    if (method === 'POST' && /^\/api\/plugins\/[^/]+\/update$/.test(pathname)) {
      const file = pathname.split('/')[3];
      return this.readJson(req).then((body) => {
        const updated = this.pluginRegistry.updatePlugin(file, body.code);
        this.json(res, 200, { ok: true, plugin: updated });
      }).catch((e) => this.json(res, 400, { error: e.message }));
    }
    if (method === 'GET' && pathname === '/api/settings') {
      const c = config.load();
      return this.json(res, 200, {
        llm: { vendor: c.llm.vendor, baseUrl: c.llm.baseUrl, model: c.llm.model, hasKey: Boolean(c.llm.apiKey) }
      });
    }
    if (method === 'POST' && pathname === '/api/settings/llm') {
      return this.readJson(req).then((body) => {
        const c = config.load();
        c.llm = { ...c.llm, ...body };
        config.save(c);
        this.json(res, 200, { ok: true });
      }).catch((e) => this.json(res, 400, { error: e.message }));
    }
    if (method === 'POST' && pathname === '/api/chat') {
      return this.handleChat(req, res);
    }
    if (method === 'POST' && /^\/api\/tools\/[^/]+\/enable$/.test(pathname)) {
      const name = pathname.split('/')[3];
      return this.readJson(req).then((body) => {
        const tool = this.registry.getTool(name);
        if (!tool) return this.json(res, 404, { error: `工具不存在: ${name}` });
        const metaPath = path.join(tool.dir, 'meta.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8').replace(/^\uFEFF/, ''));
        meta.enabled = Boolean(body.enabled);
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        this.registry.reload();
        this.json(res, 200, { ok: true, enabled: meta.enabled });
      }).catch((e) => this.json(res, 400, { error: e.message }));
    }
    if (method === 'POST' && /^\/api\/tools\/[^/]+\/delete$/.test(pathname)) {
      const name = pathname.split('/')[3];
      return this.readJson(req).then(() => {
        this.registry.removeTool(name);
        this.json(res, 200, { ok: true });
      }).catch((e) => this.json(res, 400, { error: e.message }));
    }
    if (method === 'POST' && /^\/api\/tools\/[^/]+\/run$/.test(pathname)) {
      const name = pathname.split('/')[3];
      return this.startRun(name, req, res);
    }
    if (method === 'POST' && /^\/api\/tools\/[^/]+\/run\/[^/]+\/cancel$/.test(pathname)) {
      const taskId = pathname.split('/')[5];
      return this.cancelTask(taskId, res);
    }
    if (method === 'GET' && /^\/api\/tools\/[^/]+\/run\/[^/]+\/events$/.test(pathname)) {
      const taskId = pathname.split('/')[5];
      return this.taskEvents(taskId, res);
    }
    if (method === 'GET' && /^\/api\/tools\/[^/]+\/run\/[^/]+$/.test(pathname)) {
      const taskId = pathname.split('/')[5];
      return this.taskStatus(taskId, res);
    }
    if (method === 'GET' && /^\/api\/tools\/[^/]+$/.test(pathname)) {
      const name = pathname.split('/')[3];
      const tool = this.registry.getTool(name);
      if (!tool) return this.json(res, 404, { error: `工具不存在: ${name}` });
      return this.json(res, 200, { tool });
    }
    if (method === 'GET' && pathname.startsWith('/api/files/')) {
      const parts = pathname.split('/');
      const taskId = parts[3];
      const file = decodeURIComponent(parts.slice(4).join('/'));
      return this.downloadResult(taskId, file, res);
    }
    if (pathname.startsWith('/api/')) {
      return this.json(res, 404, { error: '接口不存在' });
    }
    return this.serveStatic(pathname, res);
  }

  /**
   * 智能体聊天 SSE：事件 text（逐字）/ tool_call / tool_result / draft_tool / done / failed
   */
  handleChat(req, res) {
    return this.readJson(req).then((body) => {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      const send = (event, data) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const agent = new Agent({
        registry: this.registry,
        pluginRegistry: this.pluginRegistry,
        pluginsRoot: path.join(this.webRoot, 'plugins'),
        runner: this.runner,
        llm: config.load().llm,
        toolsRoot: this.toolsRoot,
        officecliPath: this.officecliPath
      });
      agent.chat({
        messages,
        onText: (t) => send('text', { text: t }),
        onToolCall: (c) => send('tool_call', c),
        onToolResult: (r) => send('tool_result', { name: r.name, ...r.result }),
        onDraftTool: (d) => send('draft_tool', d),
        onDraftPlugin: (d) => send('draft_plugin', d)
      }).then(() => send('done', { ok: true }))
        .catch((e) => send('failed', { error: e.message }))
        .finally(() => { try { res.end(); } catch (_) { /* 已断开 */ } });
    }).catch((e) => this.json(res, 400, { error: e.message }));
  }

  startRun(name, req, res) {
    const tool = this.registry.getTool(name);
    if (!tool) return this.json(res, 404, { error: `工具不存在: ${name}` });
    if (!tool.enabled) return this.json(res, 400, { error: `工具未启用: ${name}` });
    return this.readJson(req).then((body) => {
      const files = body.files || [];
      const min = tool.inputFiles?.min ?? 0;
      const max = tool.inputFiles?.max ?? null;
      if (files.length < min) {
        return this.json(res, 400, { error: `至少需要 ${min} 个输入文件，实际收到 ${files.length} 个` });
      }
      if (max !== null && files.length > max) {
        return this.json(res, 400, { error: `最多允许 ${max} 个输入文件，实际收到 ${files.length} 个` });
      }
      const accept = tool.accept || [];
      if (accept.length) {
        const bad = files.find((f) => {
          const ext = String(f.name).toLowerCase().split('.').pop();
          return !accept.includes(ext);
        });
        if (bad) {
          return this.json(res, 400, { error: `不支持的文件格式: ${bad.name}（仅支持 ${accept.map((e) => '.' + e).join('、')}）` });
        }
      }
      const task = this.fileStore.createTask();
      this.fileStore.saveFiles(task, files);
      // 按参数 schema 强制 type:"file" 参数映射到上传目录
      const props = tool.parameters?.properties || {};
      for (const [pname, prop] of Object.entries(props)) {
        if (prop.type === 'file') body.args[pname] = '@uploads';
      }
      const args = this.fileStore.resolveArgs(body.args || {}, task.uploadsDir, task.resultsDir);
      const ac = new AbortController();
      const record = { id: task.id, name, args, status: 'running', progress: '', result: null, error: null, ac };
      this.tasks.set(task.id, record);

      this.runner.runTool(name, args, {
        signal: ac.signal,
        onProgress: (p) => { record.progress = p; }
      })
        .then((result) => {
          record.status = 'done';
          record.result = result;
        })
        .catch((err) => {
          record.status = record.status === 'cancelled' ? 'cancelled' : 'error';
          record.error = err.message;
        });

      this.json(res, 200, { taskId: task.id });
    }).catch((e) => this.json(res, 400, { error: e.message }));
  }

  cancelTask(taskId, res) {
    const record = this.tasks.get(taskId);
    if (!record) return this.json(res, 404, { error: `任务不存在: ${taskId}` });
    if (record.status === 'running') {
      record.status = 'cancelled';
      record.ac.abort();
    }
    return this.json(res, 200, { ok: true, status: record.status });
  }

  taskStatus(taskId, res) {
    const record = this.tasks.get(taskId);
    if (!record) return this.json(res, 404, { error: `任务不存在: ${taskId}` });
    return this.json(res, 200, {
      status: record.status,
      name: record.name,
      args: record.args,
      progress: record.progress,
      result: record.result,
      error: record.error
    });
  }

  /**
   * 任务进度 SSE：实时推送 progress 事件，终态推送 done/error/cancelled 后关闭。
   * 简单实现：心跳轮询任务记录，对比上次发送的 progress/status。
   */
  taskEvents(taskId, res) {
    const record = this.tasks.get(taskId);
    if (!record) return this.json(res, 404, { error: `任务不存在: ${taskId}` });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let lastProgress = null;
    let lastStatus = null;
    const tick = () => {
      if (res.writableEnded) return;
      if (record.progress !== lastProgress) {
        lastProgress = record.progress;
        send('progress', { progress: record.progress });
      }
      if (record.status !== lastStatus) {
        lastStatus = record.status;
        if (record.status === 'done') {
          send('done', { result: record.result });
        } else if (record.status === 'error' || record.status === 'cancelled') {
          send(record.status === 'cancelled' ? 'cancelled' : 'failed', { error: record.error || record.status });
        } else {
          send('status', { status: record.status });
        }
      }
      if (record.status !== 'running') {
        clearInterval(timer);
        res.end();
      }
    };
    const timer = setInterval(tick, 400);
    tick();
    res.on('close', () => clearInterval(timer));
  }

  downloadResult(taskId, fileName, res) {
    const full = this.fileStore.resultFilePath(taskId, fileName);
    if (!full) return this.json(res, 404, { error: '文件不存在' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
    });
    fs.createReadStream(full).pipe(res);
  }

  serveStatic(pathname, res) {
    // 根路径进入入口页（landing.html），主界面保留在 /index.html
    let file = pathname === '/' ? 'landing.html' : pathname.replace(/^\/+/, '');
    const full = path.resolve(this.webRoot, file);
    if (!full.startsWith(path.resolve(this.webRoot) + path.sep) && full !== path.resolve(this.webRoot)) {
      return this.json(res, 403, { error: '禁止访问' });
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return this.json(res, 404, { error: '页面不存在' });
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  }

  readJson(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('请求体过大'));
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (_) {
          reject(new Error('请求体不是合法 JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  json(res, status, data) {
    const text = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  }
}

module.exports = { DocHelperApp };

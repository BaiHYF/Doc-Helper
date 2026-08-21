const fs = require('node:fs');
const path = require('node:path');
const { SYSTEM_PROMPT } = require('./prompts.js');

const MAX_TOOL_ROUNDS = 6;
const MAX_SCRIPT_BYTES = 300 * 1024;
const CREATE_TOOL_FN = 'create_tool';
const CREATE_PLUGIN_FN = 'create_plugin';

/** 把已启用工具转成 OpenAI function calling schema（file 类型参数提示填绝对路径） */
function toolToFunctionSchema(tool) {
  const parameters = tool.parameters && tool.parameters.type === 'object'
    ? tool.parameters
    : { type: 'object', properties: {}, required: [] };
  const props = {};
  for (const [name, prop] of Object.entries(parameters.properties || {})) {
    props[name] = prop && prop.type === 'file'
      ? { ...prop, type: 'string', description: `${prop.description || ''}（文件路径，请填写完整绝对路径）` }
      : prop;
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { ...parameters, properties: props }
    }
  };
}

/**
 * 智能体：LLM 流式 + function calling 循环。
 * 可调用已启用的工具，也可调用内置 create_tool / create_plugin 生成草稿（默认不启用）。
 */
class Agent {
  constructor({ registry, runner, llm, toolsRoot, pluginRegistry, pluginsRoot }) {
    this.registry = registry;
    this.runner = runner;
    this.llm = llm || {};
    this.toolsRoot = toolsRoot;
    this.pluginRegistry = pluginRegistry;
    this.pluginsRoot = pluginsRoot;
  }

  buildToolsSchema() {
    const schemas = this.registry.listTools()
      .filter((t) => t.enabled)
      .map(toolToFunctionSchema);
    schemas.push({
      type: 'function',
      function: {
        name: CREATE_TOOL_FN,
        description: '根据用户需求生成一个新的文档处理工具（PowerShell 脚本 tool.ps1 + 元数据 meta.json）。' +
          '生成的工具默认为草稿状态，需要用户手动启用后才能被调用。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工具名：小写字母/数字/中划线，如 my-tool' },
            description: { type: 'string', description: '工具用途说明（中文）' },
            script: { type: 'string', description: 'PowerShell 脚本内容（tool.ps1），通过 $env:OFFICECLI 调用 officecli，' +
              'stdout 最终输出一个 JSON：{"ok":true,"outputFiles":[...],"summary":"..."}，失败退出码非 0' },
            metaJson: { type: 'object', description: '工具元数据（meta.json）：含 name/description/inputFiles/accept/parameters' }
          },
          required: ['name', 'description', 'script', 'metaJson']
        }
      }
    });
    schemas.push({
      type: 'function',
      function: {
        name: CREATE_PLUGIN_FN,
        description: '根据用户需求生成一个新的前端插件（ES Module 单文件，导出 { name, description, mount, unmount }），' +
          '用于扩展应用界面或功能。生成后默认为草稿，需要用户手动启用后生效。',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '插件文件名，如 my-plugin.js（小写字母/数字/中划线 + .js）' },
            name: { type: 'string', description: '插件 ID，与文件名（去 .js）一致，如 my-plugin' },
            description: { type: 'string', description: '插件用途说明（中文）' },
            code: { type: 'string', description: '完整 ES Module 源码：import { api, $, on, emit, escapeHtml } from \'../core.js\'，' +
              'export default { name, description, mount(ctx), unmount() }' }
          },
          required: ['file', 'name', 'description', 'code']
        }
      }
    });
    return schemas;
  }

  /**
   * 执行一轮带 function calling 的对话。
   * 回调：onText(增量文本)、onToolCall({name,args})、onToolResult({name,ok,result?})、
   *        onDraftTool({name,...})、onDraftPlugin({file,...})
   */
  async chat({ messages, onText, onToolCall, onToolResult, onDraftTool, onDraftPlugin }) {
    const { baseUrl, apiKey, model } = this.llm;
    if (!apiKey) throw new Error('尚未配置大模型 API Key，请先点击右上角"设置"完成配置');
    const history = (messages || []).map((m) => ({ role: m.role, content: m.content || '' }));
    // 注入 system prompt：工具生成规范（见 server/prompts.js）
    history.unshift({ role: 'system', content: SYSTEM_PROMPT });
    const tools = this.buildToolsSchema();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await this.callLLM(baseUrl, apiKey, model, history, tools, onText);
      if (!resp.toolCalls || !resp.toolCalls.length) break;

      history.push({
        role: 'assistant',
        content: resp.content || null,
        tool_calls: resp.toolCalls.map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments }
        }))
      });
      for (const call of resp.toolCalls) {
        if (onToolCall) onToolCall({ name: call.name, args: this.safeParse(call.arguments) });
        const result = await this.executeToolCall(call, onDraftTool, onDraftPlugin);
        if (onToolResult) onToolResult({ name: call.name, ok: result.ok, result });
        history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  }

  safeParse(str) {
    try { return JSON.parse(str || '{}'); } catch (_) { return {}; }
  }

  async executeToolCall(call, onDraftTool, onDraftPlugin) {
    const name = call.name;
    const args = this.safeParse(call.arguments);

    if (name === CREATE_TOOL_FN) {
      const draft = this.createDraftTool(args);
      if (onDraftTool) onDraftTool(draft);
      return { ok: true, draft: draft.name, note: '新工具已生成草稿，待用户启用' };
    }

    if (name === CREATE_PLUGIN_FN) {
      const draft = this.createDraftPlugin(args);
      if (onDraftPlugin) onDraftPlugin(draft);
      return { ok: true, draft: draft.file, note: '新插件已生成草稿，待用户启用' };
    }

    const tool = this.registry.getTool(name);
    if (!tool) return { ok: false, error: `工具不存在: ${name}` };
    if (!tool.enabled) return { ok: false, error: `工具未启用: ${name}` };
    try {
      const result = await this.runner.runTool(name, args);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** 校验并把 agent 生成的工具落盘为草稿（enabled=false） */
  createDraftTool({ name, description, script, metaJson }) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error('工具名不合法：须为小写字母/数字/中划线（如 my-tool）');
    }
    if (path.basename(name) !== name) {
      throw new Error('工具名不合法：不允许路径分隔符');
    }
    if (typeof script !== 'string' || !script.trim()) throw new Error('生成失败：缺少脚本内容');
    if (Buffer.byteLength(script, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('生成失败：脚本内容过大');
    if (!metaJson || typeof metaJson !== 'object') throw new Error('生成失败：缺少 meta.json');

    const meta = { ...metaJson, name, description: metaJson.description || description || '', enabled: false };
    const dir = path.join(this.toolsRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    // 带 UTF-8 BOM，避免 PowerShell 5 按 ANSI 读取中文脚本乱码
    fs.writeFileSync(path.join(dir, 'tool.ps1'), '\uFEFF' + script, 'utf8');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    this.registry.reload();
    return { name, description: meta.description, enabled: false };
  }

  /** 校验并把 agent 生成的前端插件落盘为草稿（enabled=false） */
  createDraftPlugin({ file, name, description, code }) {
    if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9-]*\.js$/.test(file) || path.basename(file) !== file) {
      throw new Error('文件名不合法：须为小写字母/数字/中划线 + .js（如 my-plugin.js）');
    }
    if (typeof code !== 'string' || !code.trim()) throw new Error('生成失败：缺少代码内容');
    if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('生成失败：代码内容过大');
    if (!/\bexport\s+default\b/.test(code)) throw new Error('生成失败：代码缺少 export default');
    if (!/\bmount\s*\(/.test(code)) throw new Error('生成失败：代码缺少 mount 方法');

    const id = (typeof name === 'string' && name) || path.basename(file, '.js');
    const target = path.join(this.pluginsRoot, file);
    if (!target.startsWith(path.resolve(this.pluginsRoot) + path.sep)) {
      throw new Error('文件名不合法：不允许路径分隔符');
    }
    fs.writeFileSync(target, code, 'utf8');
    this.pluginRegistry.reload();
    this.pluginRegistry.setEnabled(file, false);
    return { file, name: id, description: description || '', enabled: false };
  }

  /** 调用 LLM（流式），解析 SSE 增量文本与 tool_calls */
  async callLLM(baseUrl, apiKey, model, history, tools, onDelta) {
    const url = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: history, tools, stream: true })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LLM 请求失败（${resp.status}）: ${text.slice(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let content = '';
    const toolCalls = new Map();

    const handleChunk = (data) => {
      if (data === '[DONE]') return;
      let json;
      try { json = JSON.parse(data); } catch (_) { return; }
      const delta = json.choices && json.choices[0] && json.choices[0].delta;
      if (!delta) return;
      if (delta.content) {
        content += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const entry = toolCalls.get(tc.index) || { id: '', name: '', arguments: '' };
          if (tc.id) entry.id = tc.id;
          if (tc.function) {
            if (tc.function.name) entry.name += tc.function.name;
            if (tc.function.arguments) entry.arguments += tc.function.arguments;
          }
          toolCalls.set(tc.index, entry);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          handleChunk(line.slice(5).trim());
        }
      }
    }
    const calls = [...toolCalls.values()].filter((c) => c.name).map((c) => ({
      id: c.id, name: c.name, arguments: c.arguments
    }));
    return { content, toolCalls: calls };
  }
}

module.exports = { Agent };

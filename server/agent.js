const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { SYSTEM_PROMPT } = require('./prompts.js');
const { getOfficecliRef } = require('./officecliRef.js');

const MAX_TOOL_ROUNDS = 6;
const MAX_SCRIPT_BYTES = 300 * 1024;
const CREATE_TOOL_FN = 'create_tool';
const DELETE_TOOL_FN = 'delete_tool';
const CREATE_PLUGIN_FN = 'create_plugin';
const OFFICECLI_HELP_FN = 'officecli_help';
const DELETE_PLUGIN_FN = 'delete_plugin';
const UPDATE_PLUGIN_FN = 'update_plugin';

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
  constructor({ registry, runner, llm, toolsRoot, pluginRegistry, pluginsRoot, officecliPath }) {
    this.registry = registry;
    this.runner = runner;
    this.llm = llm || {};
    this.toolsRoot = toolsRoot;
    this.pluginRegistry = pluginRegistry;
    this.pluginsRoot = pluginsRoot;
    this.officecliPath = officecliPath;
  }

  /**
   * 查询内置 officecli 的使用说明（help <format> [verb|element] [element]），
   * 供 agent 生成工具前确认语法。topic 可为空 / all / <格式> [动词|元素] [元素]。
   * 非法输入返回用法提示（智能体可照此重试），不抛错中断。
   */
  runOfficecliHelp({ topic }) {
    const raw = topic == null ? '' : (typeof topic === 'string' ? topic : Array.isArray(topic) ? topic.join(' ') : JSON.stringify(topic));
    const tokens = String(raw).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const valid = tokens.length <= 3 && tokens.every((t) => /^[a-z0-9-]{1,32}$/.test(t));
    if (!valid) {
      return 'officecli_help 用法提示：topic 留空=总览；all=全量元素/属性 dump；或 <格式> [动词|元素] [元素]，' +
        `如 "xlsx"、"xlsx add cell"、"docx paragraph"。收到非法 topic: ${raw ? JSON.stringify(raw) : '(空)'}`;
    }
    if (!this.officecliPath || !fs.existsSync(this.officecliPath)) {
      throw new Error('officecli 未配置');
    }
    const args = ['help', ...tokens];
    let out = '';
    try {
      out = cp.execFileSync(this.officecliPath, args, {
        encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true
      });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr ? `\n${e.stderr}` : '') || String(e.message || e);
    }
    return out.slice(0, 6000);
  }

  buildToolsSchema() {
    const schemas = this.registry.listTools()
      .filter((t) => t.enabled)
      .map(toolToFunctionSchema);
    schemas.push({
      type: 'function',
      function: {
        name: CREATE_TOOL_FN,
        description: '根据用户需求生成一个新的文档处理工具（Node 脚本 tool.js + 元数据 meta.json）。' +
          '生成的工具默认为草稿状态，需要用户手动启用后才能被调用。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工具名：小写字母/数字/中划线，如 my-tool' },
            description: { type: 'string', description: '工具用途说明（中文）' },
            script: { type: 'string', description: 'Node 脚本内容（tool.js）：module.exports = async (ctx) => {...}，' +
              '通过 ctx.run/ctx.batch 调用 officecli，返回 {outputFiles:[...],summary:"..."}，失败 throw 中文错误' },
            metaJson: { type: 'object', description: '工具元数据（meta.json）：含 name/description/inputFiles/accept/parameters' }
          },
          required: ['name', 'description', 'script', 'metaJson']
        }
      }
    });
    schemas.push({
      type: 'function',
      function: {
        name: DELETE_TOOL_FN,
        description: '删除一个现有文档处理工具（删除 tools/<name>/ 目录，不可恢复）。删除后该工具立即从工具列表消失，需用户确认。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '要删除的工具名，如 my-tool（小写字母/数字/中划线）' }
          },
          required: ['name']
        }
      }
    });
    schemas.push({
      type: 'function',
      function: {
        name: OFFICECLI_HELP_FN,
        description: '查询内置 officecli 的使用说明（schema 驱动的能力参考：支持格式、元素、属性、命令语法）。' +
          '生成工具前必须先调用它确认命令/元素/属性存在，不要凭空发明。' +
          'topic 语法：留空=总览；all=全量元素/属性 dump；或 <格式> [动词或元素] [元素]，如 "xlsx"、"xlsx add cell"。',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: '查询词（可含空格分隔的多词）：如 "xlsx"、"xlsx add cell"、"all"；留空返回总览' }
          },
          required: []
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
    schemas.push({
      type: 'function',
      function: {
        name: DELETE_PLUGIN_FN,
        description: '删除一个现有前端插件（不可恢复）。删除后该插件立即从应用消失，需用户确认。',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '要删除的插件文件名，如 my-plugin.js' }
          },
          required: ['file']
        }
      }
    });
    schemas.push({
      type: 'function',
      function: {
        name: UPDATE_PLUGIN_FN,
        description: '修改一个现有前端插件：用新的完整源码覆盖该插件文件，保留启用状态。',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '要修改的插件文件名，如 my-plugin.js' },
            code: { type: 'string', description: '新的完整 ES Module 源码：import { api, $, on, emit, escapeHtml } from \'../core.js\'，' +
              'export default { name, description, mount(ctx), unmount() }' }
          },
          required: ['file', 'code']
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
    // 注入 system prompt：工具生成规范（见 server/prompts.js）+ officecli 能力索引（减少重复 help 查询）
    const ref = getOfficecliRef(this.officecliPath);
    history.unshift({ role: 'system', content: ref ? `${SYSTEM_PROMPT}\n\n${ref}` : SYSTEM_PROMPT });
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

    if (name === DELETE_TOOL_FN) {
      const r = this.deleteTool(args);
      return { ok: true, deleted: r.name, note: `工具已删除: ${r.name}` };
    }

    if (name === OFFICECLI_HELP_FN) {
      const help = this.runOfficecliHelp(args);
      return { ok: true, help };
    }

    if (name === DELETE_PLUGIN_FN) {
      const r = this.deletePlugin(args);
      return { ok: true, deleted: r.file, note: `插件已删除: ${r.file}` };
    }

    if (name === UPDATE_PLUGIN_FN) {
      const r = this.updatePlugin(args);
      return { ok: true, file: r.file, note: `插件已更新: ${r.file}` };
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
    if (!/\bmodule\.exports\s*=|^export\b/m.test(script)) throw new Error('生成失败：脚本缺少 module.exports（tool.js 须导出 async 函数）');
    if (!metaJson || typeof metaJson !== 'object') throw new Error('生成失败：缺少 meta.json');

    const meta = { ...metaJson, name, description: metaJson.description || description || '', enabled: false };
    const dir = path.join(this.toolsRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    // Node 胶水脚本：原生 UTF-8，无 BOM/param/编码类 PowerShell 坑
    fs.writeFileSync(path.join(dir, 'tool.js'), script, 'utf8');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    this.registry.reload();
    return {
      name,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : name,
      description: meta.description,
      enabled: false
    };
  }

  /** 删除现有工具（删除 tools/<name>/ 目录，不可恢复）。 */
  deleteTool({ name }) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name) || path.basename(name) !== name) {
      throw new Error('工具名不合法：须为小写字母/数字/中划线');
    }
    return this.registry.removeTool(name);
  }

  /** 校验并把 agent 生成的前端插件落盘为草稿（enabled=false） */
  createDraftPlugin({ file, name, description, code }) {
    this.assertPluginFile(file);
    if (typeof code !== 'string' || !code.trim()) throw new Error('生成失败：缺少代码内容');
    if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('生成失败：代码内容过大');
    if (!/\bexport\s+default\b/.test(code)) throw new Error('生成失败：代码缺少 export default');
    if (!/\bmount\s*\(/.test(code)) throw new Error('生成失败：代码缺少 mount 方法');

    const id = (typeof name === 'string' && name) || path.basename(file, '.js');
    const target = path.join(this.pluginsRoot, file);
    fs.writeFileSync(target, code, 'utf8');
    this.pluginRegistry.reload();
    this.pluginRegistry.setEnabled(file, false);
    return { file, name: id, description: description || '', enabled: false };
  }

  /** 删除现有插件（文件 + 状态）。 */
  deletePlugin({ file }) {
    this.assertPluginFile(file);
    return this.pluginRegistry.removePlugin(file);
  }

  /** 用新源码更新现有插件，保留启用状态。 */
  updatePlugin({ file, code }) {
    this.assertPluginFile(file);
    if (typeof code !== 'string' || !code.trim()) throw new Error('修改失败：缺少代码内容');
    if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('修改失败：代码内容过大');
    if (!/\bexport\s+default\b/.test(code)) throw new Error('修改失败：代码缺少 export default');
    if (!/\bmount\s*\(/.test(code)) throw new Error('修改失败：代码缺少 mount 方法');
    return this.pluginRegistry.updatePlugin(file, code);
  }

  /** 校验插件文件名（小写字母/数字/中划线 + .js，无路径分隔符） */
  assertPluginFile(file) {
    if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9-]*\.js$/.test(file) || path.basename(file) !== file) {
      throw new Error('文件名不合法：须为小写字母/数字/中划线 + .js（如 my-plugin.js）');
    }
  }

  /** 调用 LLM（流式），解析 SSE 增量文本与 tool_calls */
  async callLLM(baseUrl, apiKey, model, history, tools, onDelta) {
    const url = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: history, tools, stream: true, max_tokens: 8192 })
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

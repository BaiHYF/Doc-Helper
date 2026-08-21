const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Agent } = require('../server/agent.js');
const { ToolRegistry } = require('../server/toolRegistry.js');
const { PluginRegistry } = require('../server/pluginRegistry.js');

function makeAgent() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-agent-'));
  const toolsRoot = path.join(tmp, 'tools');
  fs.mkdirSync(toolsRoot, { recursive: true });
  const registry = new ToolRegistry(toolsRoot);
  const agent = new Agent({ registry, runner: null, llm: { apiKey: 'x' }, toolsRoot });
  return { agent, toolsRoot, registry };
}

test('createDraftTool 落盘草稿且 enabled=false', () => {
  const { agent, toolsRoot, registry } = makeAgent();
  const draft = agent.createDraftTool({
    name: 'my-tool',
    description: '测试工具',
    script: 'Write-Output "hello"',
    metaJson: { description: '测试工具', inputFiles: { min: 1 } }
  });
  assert.equal(draft.enabled, false);
  assert.equal(draft.name, 'my-tool');
  assert.ok(fs.existsSync(path.join(toolsRoot, 'my-tool', 'tool.ps1')));
  assert.ok(fs.existsSync(path.join(toolsRoot, 'my-tool', 'meta.json')));
  const meta = JSON.parse(fs.readFileSync(path.join(toolsRoot, 'my-tool', 'meta.json'), 'utf-8'));
  assert.equal(meta.enabled, false);
  assert.equal(meta.name, 'my-tool');
  const tool = registry.getTool('my-tool');
  assert.equal(tool.enabled, false);
});

test('createDraftTool 拒绝非法工具名（大小写/路径分隔符）', () => {
  const { agent } = makeAgent();
  assert.throws(() => agent.createDraftTool({ name: 'My Tool', script: 'x', metaJson: {} }), /工具名不合法/);
  assert.throws(() => agent.createDraftTool({ name: 'a/../b', script: 'x', metaJson: {} }), /工具名不合法/);
});

test('createDraftTool 拒绝缺少脚本或 metaJson', () => {
  const { agent } = makeAgent();
  assert.throws(() => agent.createDraftTool({ name: 'ok-tool', script: '', metaJson: {} }), /缺少脚本/);
  assert.throws(() => agent.createDraftTool({ name: 'ok-tool', script: 'x' }), /缺少 meta\.json/);
});

test('buildToolsSchema 暴露 create_tool 工具', () => {
  const { agent } = makeAgent();
  const schemas = agent.buildToolsSchema();
  assert.ok(schemas.some((s) => s.function.name === 'create_tool'));
});

test('buildToolsSchema 把 file 参数转为 string 并提示绝对路径', () => {
  const { agent, toolsRoot } = makeAgent();
  fs.mkdirSync(path.join(toolsRoot, 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(toolsRoot, 'alpha', 'meta.json'), JSON.stringify({
    name: 'alpha', version: '1.0.0', enabled: true, description: 'a',
    inputFiles: { min: 1 },
    parameters: {
      type: 'object',
      properties: {
        inputDir: { type: 'file', description: '输入目录' },
        output: { type: 'string', output: true, description: '输出路径' }
      },
      required: ['inputDir', 'output']
    }
  }));
  agent.registry.reload();
  const schemas = agent.buildToolsSchema();
  const fn = schemas.find((s) => s.function.name === 'alpha');
  assert.equal(fn.function.parameters.properties.inputDir.type, 'string');
  assert.match(fn.function.parameters.properties.inputDir.description, /绝对路径/);
  assert.equal(fn.function.parameters.properties.output.output, true);
});

/* ---------- create_plugin ---------- */

function makePluginAgent() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-agent-plugin-'));
  const pluginsRoot = path.join(tmp, 'plugins');
  fs.mkdirSync(pluginsRoot, { recursive: true });
  const toolsRoot = path.join(tmp, 'tools');
  fs.mkdirSync(toolsRoot, { recursive: true });
  const pluginRegistry = new PluginRegistry(pluginsRoot, path.join(tmp, 'plugins-state.json'));
  const agent = new Agent({
    registry: new ToolRegistry(toolsRoot),
    runner: null,
    llm: { apiKey: 'x' },
    toolsRoot,
    pluginRegistry,
    pluginsRoot
  });
  return { agent, pluginsRoot, pluginRegistry };
}

test('buildToolsSchema 暴露 create_plugin 工具', () => {
  const { agent } = makePluginAgent();
  const schemas = agent.buildToolsSchema();
  assert.ok(schemas.some((s) => s.function.name === 'create_plugin'));
});

test('createDraftPlugin 落盘草稿且 enabled=false', () => {
  const { agent, pluginsRoot, pluginRegistry } = makePluginAgent();
  const draft = agent.createDraftPlugin({
    file: 'my-plugin.js',
    name: 'my-plugin',
    description: '示例插件',
    code: `/* 插件：示例插件 */
import { $ } from '../core.js';
export default {
  name: 'my-plugin',
  mount() {},
  unmount() {}
};`
  });
  assert.equal(draft.enabled, false);
  assert.equal(draft.file, 'my-plugin.js');
  assert.ok(fs.existsSync(path.join(pluginsRoot, 'my-plugin.js')));
  const p = pluginRegistry.getPlugin('my-plugin.js');
  assert.equal(p.enabled, false);
  assert.equal(p.description, '示例插件');
});

test('createDraftPlugin 拒绝非法文件名（大写/路径分隔符/非 js）', () => {
  const { agent } = makePluginAgent();
  const code = 'export default { name: "x", mount() {} };';
  assert.throws(() => agent.createDraftPlugin({ file: 'My Plugin.js', code }), /文件名不合法/);
  assert.throws(() => agent.createDraftPlugin({ file: 'a/../b.js', code }), /文件名不合法/);
  assert.throws(() => agent.createDraftPlugin({ file: 'noext', code }), /文件名不合法/);
});

test('createDraftPlugin 拒绝空代码 / 过大 / 缺 export default / 缺 mount', () => {
  const { agent } = makePluginAgent();
  assert.throws(() => agent.createDraftPlugin({ file: 'a.js', code: '' }), /缺少代码/);
  assert.throws(() => agent.createDraftPlugin({ file: 'a.js', code: 'const x=1;' }), /export default/);
  assert.throws(() => agent.createDraftPlugin({ file: 'a.js', code: 'export default { name: "a" };' }), /mount/);
  assert.throws(() => agent.createDraftPlugin({ file: 'a.js', code: 'x'.repeat(400 * 1024) }), /过大/);
});

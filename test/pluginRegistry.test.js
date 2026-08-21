const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PluginRegistry } = require('../server/pluginRegistry.js');

/** 构造一个含多个插件的临时目录 */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-plugins-'));
  const write = (file, source) => fs.writeFileSync(path.join(root, file), source);

  write('settings.js', `/* 插件：设置面板（LLM 配置） */
import { api, $ } from '../core.js';
export default {
  name: 'settings',
  mount() {},
  unmount() {}
};`);
  write('chatSidebar.js', `/* 插件：智能体聊天侧边栏 */
import { on, emit } from '../core.js';
export default {
  name: 'chatSidebar',
  mount() {},
  unmount() {}
};`);
  // 草稿插件（状态文件标记 disabled）
  write('my-plugin.js', `/* 插件：自定义示例插件 */
import { $ } from '../core.js';
export default {
  name: 'my-plugin',
  mount() {},
  unmount() {}
};`);
  // 非 JS 文件应被忽略
  write('README.txt', 'not a plugin');
  return root;
}

function makeRegistry(fixtureRoot) {
  const statePath = path.join(fixtureRoot, 'plugins-state.json');
  return { reg: new PluginRegistry(fixtureRoot, statePath), statePath };
}

test('listPlugins 扫描目录并返回插件清单（name/description/enabled）', () => {
  const root = makeFixture();
  // 先把 my-plugin 标记为草稿（disabled）
  const { reg, statePath } = makeRegistry(root);
  fs.writeFileSync(statePath, JSON.stringify({ 'my-plugin.js': { enabled: false } }));
  reg.reload();

  const plugins = reg.listPlugins();
  // settings/chatSidebar/my-plugin 三个 js，README.txt 忽略
  assert.equal(plugins.length, 3);
  const chat = plugins.find((p) => p.file === 'chatSidebar.js');
  assert.equal(chat.name, 'chatSidebar');
  assert.equal(chat.description, '智能体聊天侧边栏');
  assert.equal(chat.enabled, true);
  const draft = plugins.find((p) => p.file === 'my-plugin.js');
  assert.equal(draft.enabled, false);
});

test('listPlugins 未列出状态文件的插件默认启用', () => {
  const root = makeFixture();
  const { reg } = makeRegistry(root);
  const plugins = reg.listPlugins();
  assert.ok(plugins.every((p) => p.enabled === true));
});

test('getPlugin 按文件名返回插件，缺失返回 undefined', () => {
  const root = makeFixture();
  const { reg } = makeRegistry(root);
  assert.equal(reg.getPlugin('settings.js').name, 'settings');
  assert.equal(reg.getPlugin('nope.js'), undefined);
});

test('setEnabled 更新状态并持久化到状态文件', () => {
  const root = makeFixture();
  const { reg, statePath } = makeRegistry(root);
  const r = reg.setEnabled('chatSidebar.js', false);
  assert.equal(r.enabled, false);
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  assert.equal(saved['chatSidebar.js'].enabled, false);
  // reload 后仍生效
  reg.reload();
  assert.equal(reg.getPlugin('chatSidebar.js').enabled, false);
});

test('setEnabled 拒绝不存在的插件', () => {
  const root = makeFixture();
  const { reg } = makeRegistry(root);
  assert.throws(() => reg.setEnabled('nope.js', true), /插件不存在/);
});

test('无 export default 的 js 文件被忽略', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-plugins-'));
  fs.writeFileSync(path.join(root, 'broken.js'), 'const x = 1;');
  const { reg } = makeRegistry(root);
  assert.equal(reg.listPlugins().length, 0);
});

test('源码缺 name 时回退用文件名作为插件名', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-plugins-'));
  fs.writeFileSync(path.join(root, 'no-name.js'), `/* 插件：无名插件 */
export default { mount() {}, unmount() {} };`);
  const { reg } = makeRegistry(root);
  const p = reg.getPlugin('no-name.js');
  assert.equal(p.name, 'no-name');
  assert.equal(p.description, '无名插件');
});

/* ---------- removePlugin / updatePlugin ---------- */

test('removePlugin 删除文件并清理状态', () => {
  const root = makeFixture();
  const { reg, statePath } = makeRegistry(root);
  reg.setEnabled('my-plugin.js', false);
  assert.ok(fs.existsSync(path.join(root, 'my-plugin.js')));

  const r = reg.removePlugin('my-plugin.js');
  assert.equal(r.file, 'my-plugin.js');
  assert.ok(!fs.existsSync(path.join(root, 'my-plugin.js')));
  // 状态文件中的记录被清理
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  assert.equal(saved['my-plugin.js'], undefined);
  assert.equal(reg.getPlugin('my-plugin.js'), undefined);
});

test('removePlugin 拒绝不存在的插件 / 非法文件名', () => {
  const root = makeFixture();
  const { reg } = makeRegistry(root);
  assert.throws(() => reg.removePlugin('nope.js'), /插件不存在/);
  assert.throws(() => reg.removePlugin('a/../b.js'), /路径分隔符/);
});

test('updatePlugin 覆盖源码并保留启用状态', () => {
  const root = makeFixture();
  const { reg } = makeRegistry(root);
  reg.setEnabled('my-plugin.js', true);

  const updated = reg.updatePlugin('my-plugin.js', `/* 插件：修改后的示例插件 */
export default {
  name: 'my-plugin',
  mount() {},
  unmount() {}
};`);
  assert.equal(updated.file, 'my-plugin.js');
  assert.equal(updated.description, '修改后的示例插件');
  assert.equal(updated.enabled, true);
  const source = fs.readFileSync(path.join(root, 'my-plugin.js'), 'utf-8');
  assert.match(source, /修改后的示例插件/);
});

test('updatePlugin 拒绝非法源码（无 export default）/ 不存在的插件', () => {
  const root = makeFixture();
  const { reg } = makeRegistry(root);
  assert.throws(() => reg.updatePlugin('settings.js', 'const x = 1;'), /export default/);
  assert.throws(() => reg.updatePlugin('nope.js', 'export default { mount() {} };'), /插件不存在/);
});

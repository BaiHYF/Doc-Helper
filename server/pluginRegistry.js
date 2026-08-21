const fs = require('node:fs');
const path = require('node:path');

/**
 * 插件注册表：扫描 web/plugins/*.js 生成前端插件清单。
 * 插件为单文件 ES Module，导出 { name, description, mount, unmount }。
 * 元信息（name/description）从源码提取；启用状态持久化在独立状态文件。
 */
class PluginRegistry {
  /**
   * @param {string} pluginsRoot web/plugins 目录
   * @param {string} statePath  状态文件路径（JSON: { "<file>": { enabled } }）
   */
  constructor(pluginsRoot, statePath) {
    this.pluginsRoot = pluginsRoot;
    this.statePath = statePath;
    this.cache = null;
  }

  reload() {
    this.cache = null;
  }

  /** 读取启用状态表：{ file -> bool }，缺省视为启用 */
  _loadState() {
    if (!fs.existsSync(this.statePath)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      const out = {};
      for (const [file, v] of Object.entries(raw || {})) {
        if (v && typeof v === 'object') out[file] = v.enabled !== false;
      }
      return out;
    } catch (_) {
      return {};
    }
  }

  _saveState(state) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  /** 扫描目录，返回插件清单（含草稿标记）。无法识别的 js 文件被忽略。 */
  listPlugins() {
    if (this.cache) return this.cache;
    const plugins = [];
    if (!fs.existsSync(this.pluginsRoot)) {
      this.cache = plugins;
      return plugins;
    }
    const state = this._loadState();
    for (const entry of fs.readdirSync(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const file = entry.name;
      const source = fs.readFileSync(path.join(this.pluginsRoot, file), 'utf-8').replace(/^\uFEFF/, '');
      const meta = parsePluginMeta(source, file);
      if (!meta) continue;
      plugins.push({
        file,
        name: meta.name,
        description: meta.description,
        enabled: state[file] !== undefined ? state[file] : true
      });
    }
    plugins.sort((a, b) => a.file.localeCompare(b.file));
    this.cache = plugins;
    return plugins;
  }

  getPlugin(file) {
    return this.listPlugins().find((p) => p.file === file);
  }

  /** 启用/停用插件，返回更新后的插件信息。 */
  setEnabled(file, enabled) {
    if (!this.getPlugin(file)) throw new Error(`插件不存在: ${file}`);
    const state = this._loadState();
    state[file] = { enabled: Boolean(enabled) };
    this._saveState(state);
    this.reload();
    return { ...this.getPlugin(file), enabled: Boolean(enabled) };
  }

  /** 删除插件文件并清理状态（不可恢复）。 */
  removePlugin(file) {
    this._assertSafeFile(file);
    const target = path.join(this.pluginsRoot, file);
    if (!fs.existsSync(target)) throw new Error(`插件不存在: ${file}`);
    fs.unlinkSync(target);
    const state = this._loadState();
    delete state[file];
    this._saveState(state);
    this.reload();
    return { file };
  }

  /** 用新源码覆盖插件文件，保留启用状态。源码不合法时拒绝写入。 */
  updatePlugin(file, source) {
    this._assertSafeFile(file);
    const target = path.join(this.pluginsRoot, file);
    if (!fs.existsSync(target)) throw new Error(`插件不存在: ${file}`);
    if (!/\bexport\s+default\b/.test(source)) throw new Error('代码无效：缺少 export default');
    fs.writeFileSync(target, source, 'utf8');
    this.reload();
    const p = this.getPlugin(file);
    if (!p) throw new Error('代码无效：无法解析插件元信息');
    return p;
  }

  /** 校验文件名安全（仅允许 pluginsRoot 内的单层 js 文件） */
  _assertSafeFile(file) {
    if (typeof file !== 'string' || path.basename(file) !== file || !file.endsWith('.js')) {
      throw new Error('文件名不合法：不允许路径分隔符');
    }
    const target = path.resolve(this.pluginsRoot, file);
    if (!target.startsWith(path.resolve(this.pluginsRoot) + path.sep)) {
      throw new Error('文件名不合法：不允许路径分隔符');
    }
  }
}

module.exports = { PluginRegistry };

/**
 * 从插件源码提取元信息。
 * - name：export default 里的 name 字段；缺失时回退用文件名（去 .js）
 * - description：优先首行「插件：xxx」注释；否则 export 里的 description
 * - 无 export default 的 js 文件返回 null（忽略）
 */
function parsePluginMeta(source, file) {
  if (!/\bexport\s+default\b/.test(source)) return null;
  const nameMatch = source.match(/export\s+default\s*\{[\s\S]*?\bname\s*:\s*['"]([^'"]+)['"]/);
  const descMatch = source.match(/^\s*\/\*\s*插件[：:]\s*([^*]+?)\s*\*\//) ||
    source.match(/export\s+default\s*\{[\s\S]*?\bdescription\s*:\s*['"]([^'"]*)['"]/);
  return {
    name: nameMatch ? nameMatch[1] : path.basename(file, '.js'),
    description: descMatch ? descMatch[1].trim() : ''
  };
}

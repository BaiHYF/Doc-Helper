const fs = require('node:fs');
const path = require('node:path');

/**
 * 工具注册表：扫描 tools/<name>/meta.json 生成工具清单。
 * 工具生命周期：草稿（enabled=false）不出现在 function schema 中。
 */
class ToolRegistry {
  constructor(toolsRoot) {
    this.toolsRoot = toolsRoot;
    this.cache = null;
  }

  reload() {
    this.cache = null;
  }

  /** 扫描目录，返回工具清单（含草稿）。无效的目录被忽略。 */
  listTools() {
    if (this.cache) return this.cache;
    const tools = [];
    if (!fs.existsSync(this.toolsRoot)) {
      this.cache = tools;
      return tools;
    }
    for (const entry of fs.readdirSync(this.toolsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(this.toolsRoot, entry.name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch (_) {
        continue;
      }
      if (!meta || typeof meta.name !== 'string' || typeof meta.description !== 'string') {
        continue;
      }
      tools.push({
        name: meta.name,
        version: meta.version || '0.0.0',
        enabled: meta.enabled !== false,
        description: meta.description,
        parameters: meta.parameters || { type: 'object', properties: {}, required: [] },
        inputFiles: normalizeInputFiles(meta.inputFiles),
        accept: normalizeAccept(meta.accept),
        dir: path.join(this.toolsRoot, entry.name)
      });
    }
    tools.sort((a, b) => a.name.localeCompare(b.name));
    this.cache = tools;
    return tools;
  }

  getTool(name) {
    return this.listTools().find((t) => t.name === name);
  }

  /** 仅已启用工具，转 OpenAI function calling schema。 */
  buildFunctionSchemas() {
    return this.listTools()
      .filter((t) => t.enabled)
      .map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
  }
}

module.exports = { ToolRegistry };

/** 归一化输入文件数量约束：min 默认 0，max 为 null 或未声明表示不限。 */
function normalizeInputFiles(inputFiles) {
  const src = inputFiles && typeof inputFiles === 'object' ? inputFiles : {};
  const min = Number.isInteger(src.min) && src.min >= 0 ? src.min : 0;
  const max = Number.isInteger(src.max) && src.max >= 0 ? src.max : null;
  if (max !== null && min > max) {
    return { min, max: min };
  }
  return { min, max };
}

/** 归一化允许的文件扩展名：小写、去前导点；空数组表示不限。 */
function normalizeAccept(accept) {
  if (!Array.isArray(accept)) return [];
  return accept
    .map((e) => String(e).toLowerCase().replace(/^\./, ''))
    .filter((e) => /^[a-z0-9]+$/.test(e));
}

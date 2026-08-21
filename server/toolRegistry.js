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

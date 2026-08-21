const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRegistry } = require('../server/toolRegistry.js');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-tools-'));
  const writeTool = (name, meta) => {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'meta.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(root, name, 'tool.ps1'), '# dummy');
  };
  writeTool('alpha', {
    name: 'alpha', version: '1.0.0', enabled: true,
    description: 'alpha tool',
    parameters: {
      type: 'object',
      properties: { inputDir: { type: 'string' } },
      required: ['inputDir']
    }
  });
  writeTool('beta', {
    name: 'beta', version: '0.1.0', enabled: false,
    description: 'beta draft',
    parameters: { type: 'object', properties: {} }
  });
  // 无 meta.json 的目录应被忽略
  fs.mkdirSync(path.join(root, 'broken'));
  return root;
}

test('listTools 扫描目录并返回工具清单（含草稿标记）', () => {
  const root = makeFixture();
  const reg = new ToolRegistry(root);
  const tools = reg.listTools();
  assert.equal(tools.length, 2);
  const alpha = tools.find((t) => t.name === 'alpha');
  assert.equal(alpha.enabled, true);
  assert.equal(alpha.description, 'alpha tool');
  const beta = tools.find((t) => t.name === 'beta');
  assert.equal(beta.enabled, false);
});

test('getTool 返回指定工具，缺失返回 undefined', () => {
  const root = makeFixture();
  const reg = new ToolRegistry(root);
  assert.equal(reg.getTool('alpha').name, 'alpha');
  assert.equal(reg.getTool('nope'), undefined);
});

test('buildFunctionSchemas 只包含已启用工具，输出 OpenAI function 格式', () => {
  const root = makeFixture();
  const reg = new ToolRegistry(root);
  const schemas = reg.buildFunctionSchemas();
  assert.equal(schemas.length, 1);
  assert.equal(schemas[0].type, 'function');
  assert.equal(schemas[0].function.name, 'alpha');
  assert.deepEqual(schemas[0].function.parameters.properties, {
    inputDir: { type: 'string' }
  });
});

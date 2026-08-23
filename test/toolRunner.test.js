const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');

function makeTool(name, ps1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-run-'));
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tool.ps1'), ps1);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name, enabled: true, description: 'fixture' }));
  return root;
}

function makeToolJs(name, js, params) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-runjs-'));
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tool.js'), js);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    name,
    enabled: true,
    description: 'fixture',
    parameters: {
      type: 'object',
      properties: params || {},
      required: Object.keys(params || {})
    }
  }));
  return root;
}

const OFFICECLI = path.resolve(__dirname, '..', 'vendor', 'officecli', 'officecli.exe');

const OK_PS1 = `
param([string]$inputDir)
$result = @{ ok = $true; summary = "done $inputDir"; outputFiles = @("out.xlsx") } | ConvertTo-Json -Compress
Write-Output $result
`;

const FAIL_PS1 = `
Write-Error "boom"
exit 1
`;

const SLOW_PS1 = `Start-Sleep -Seconds 30; Write-Output '{"ok":true}'`;

const NOISE_PS1 = `
Write-Host "processing..."
Write-Output '{"ok":true,"summary":"noisy"}'
`;

const BADJSON_PS1 = `Write-Output "not json at all"`;

test('runTool 成功：解析 stdout JSON 并返回结果', async () => {
  const root = makeTool('ok', OK_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe' });
  const res = await runner.runTool('ok', { inputDir: 'C:\\in' });
  assert.equal(res.ok, true);
  assert.equal(res.summary, 'done C:\\in');
  assert.deepEqual(res.outputFiles, ['out.xlsx']);
});

test('runTool 非 0 退出码：抛错并携带 stderr', async () => {
  const root = makeTool('fail', FAIL_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe' });
  await assert.rejects(
    () => runner.runTool('fail', {}),
    (err) => err.message.includes('boom')
  );
});

test('runTool 超时：中止并抛超时错误', async () => {
  const root = makeTool('slow', SLOW_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe', timeoutMs: 300 });
  await assert.rejects(
    () => runner.runTool('slow', {}),
    (err) => /超时/.test(err.message)
  );
});

test('runTool 支持取消：abort 信号中止执行', async () => {
  const root = makeTool('slow', SLOW_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe' });
  const ac = new AbortController();
  const p = runner.runTool('slow', {}, { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  await assert.rejects(() => p, (err) => /取消/.test(err.message));
});

test('runTool 容忍 stdout 中的日志噪音，取最后一行 JSON', async () => {
  const root = makeTool('noise', NOISE_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe' });
  const res = await runner.runTool('noise', {});
  assert.equal(res.ok, true);
  assert.equal(res.summary, 'noisy');
});

test('runTool 无法解析输出：抛错', async () => {
  const root = makeTool('bad', BADJSON_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe' });
  await assert.rejects(
    () => runner.runTool('bad', {}),
    (err) => /解析/.test(err.message)
  );
});

test('runTool 未知工具：抛错', async () => {
  const root = makeTool('ok', OK_PS1);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: 'officecli.exe' });
  await assert.rejects(() => runner.runTool('nope', {}), (err) => /不存在/.test(err.message));
});

/* ---------- Node 工具（tool.js） ---------- */

const OK_JS = `module.exports = async (ctx) => ({ outputFiles: ['out.xlsx'], summary: 'done' });`;
const COUNT_JS = `module.exports = async (ctx) => ({
  outputFiles: [],
  summary: 'files=' + (ctx.args.inputDir || []).length + ' first=' + String((ctx.args.inputDir || [])[0] || '')
});`;
const FAIL_JS = `module.exports = async () => { throw new Error('boom-js'); };`;
const SLOW_JS = `module.exports = async () => { await new Promise((r) => setTimeout(r, 30000)); };`;
const PROGRESS_JS = `module.exports = async (ctx) => {
  ctx.progress('第一步');
  ctx.progress('第二步');
  return { outputFiles: [], summary: 'ok' };
};`;

test('runTool Node 工具：成功解析并返回结果', async () => {
  const root = makeToolJs('ok-js', OK_JS);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: OFFICECLI });
  const res = await runner.runTool('ok-js', { inputDir: 'C:\\in' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.outputFiles, ['out.xlsx']);
  assert.equal(res.summary, 'done');
});

test('runTool Node 工具：type:file 参数解析为文件数组', async () => {
  const root = makeToolJs('count-js', COUNT_JS, { inputDir: { type: 'file', description: '目录' } });
  const uploads = path.join(root, 'uploads');
  fs.mkdirSync(uploads);
  fs.writeFileSync(path.join(uploads, 'a.xlsx'), 'x');
  fs.writeFileSync(path.join(uploads, 'b.xlsx'), 'x');
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: OFFICECLI });
  const res = await runner.runTool('count-js', { inputDir: uploads });
  assert.ok(res.summary.startsWith('files=2 first='));
  assert.ok(res.summary.includes('a.xlsx'));
});

test('runTool Node 工具：throw 时抛错携带信息', async () => {
  const root = makeToolJs('fail-js', FAIL_JS);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: OFFICECLI });
  await assert.rejects(() => runner.runTool('fail-js', {}), (err) => err.message.includes('boom-js'));
});

test('runTool Node 工具：进度回调', async () => {
  const root = makeToolJs('prog-js', PROGRESS_JS);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: OFFICECLI });
  const progress = [];
  await runner.runTool('prog-js', {}, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress, ['第一步', '第二步']);
});

test('runTool Node 工具：超时中止', async () => {
  const root = makeToolJs('slow-js', SLOW_JS);
  const runner = new ToolRunner({ toolsRoot: root, officecliPath: OFFICECLI, timeoutMs: 300 });
  await assert.rejects(() => runner.runTool('slow-js', {}), (err) => /超时/.test(err.message));
});

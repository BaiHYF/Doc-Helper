const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRunner } = require('../server/toolRunner.js');

const OFFICECLI = path.resolve(__dirname, '..', 'vendor', 'officecli', 'officecli.exe');
const TOOLS_ROOT = path.resolve(__dirname, '..', 'tools');

function exec(officecli, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(officecli, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${args.join(' ')} failed (${code}): ${stderr}`));
      else resolve(stdout);
    });
  });
}

async function execBatch(officecli, file, commands) {
  const tmp = path.join(os.tmpdir(), `dh-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(commands));
  try {
    await exec(officecli, ['batch', file, '--input', tmp]);
  } finally {
    fs.unlinkSync(tmp);
  }
}

async function makeWorkbook(file, sheetName, rows) {
  await exec(OFFICECLI, ['create', file]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheetName } }];
  rows.forEach((row, ri) => {
    row.forEach((value, ci) => {
      cmds.push({
        command: 'add', parent: `/${sheetName}`, type: 'cell',
        props: { ref: `${String.fromCharCode(65 + ci)}${ri + 1}`, value: String(value) }
      });
    });
  });
  await execBatch(OFFICECLI, file, cmds);
  await exec(OFFICECLI, ['save', file]);
}

test('xlsx-merge-sheets 集成：合并两个工作簿并保留数据', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-merge-'));
  const inputDir = path.join(work, 'input');
  fs.mkdirSync(inputDir);

  await makeWorkbook(path.join(inputDir, 'alpha.xlsx'), 'AlphaData', [
    ['name', 'age'],
    ['Alice', 30],
    ['Bob', 25]
  ]);
  await makeWorkbook(path.join(inputDir, 'beta.xlsx'), 'BetaData', [
    ['name', 'age'],
    ['Carol', 40],
    ['Dave', 35]
  ]);

  const output = path.join(work, 'merged.xlsx');
  const runner = new ToolRunner({ toolsRoot: TOOLS_ROOT, officecliPath: OFFICECLI, timeoutMs: 60000 });
  const res = await runner.runTool('xlsx-merge-sheets', { inputDir, output });

  assert.equal(res.ok, true);
  assert.deepEqual(res.outputFiles, [output]);
  assert.equal(res.sheets.length, 2);
  assert.ok(res.sheets.includes('alpha'));
  assert.ok(res.sheets.includes('beta'));

  // 验证输出工作簿内容
  const out = JSON.parse(await exec(OFFICECLI, ['get', output, '/', '--json']));
  const sheets = out.data.results[0].children.filter((c) => c.type === 'sheet');
  assert.deepEqual(sheets.map((s) => s.path.split('/').pop()), ['alpha', 'beta']);

  const alpha = JSON.parse(await exec(OFFICECLI, ['get', output, '/alpha', '--json']));
  const texts = JSON.stringify(alpha);
  assert.ok(texts.includes('Alice'));
  assert.ok(texts.includes('Bob'));

  const beta = JSON.parse(await exec(OFFICECLI, ['get', output, '/beta', '--json']));
  const betaTexts = JSON.stringify(beta);
  assert.ok(betaTexts.includes('Carol'));
  assert.ok(betaTexts.includes('Dave'));

  // 清理：先终止 officecli resident 进程释放文件锁
  try {
    require('node:child_process').execSync('taskkill /IM officecli.exe /F', { stdio: 'ignore' });
  } catch (_) { /* 无残留进程时忽略 */ }
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

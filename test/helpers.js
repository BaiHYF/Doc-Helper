/** 集成测试公共辅助：officecli 执行、xlsx/docx 夹具构造与读取 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

/** 创建 xlsx 工作簿：单工作表 + 行数据 */
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

/** 创建 xlsx 工作簿：多工作表（{name, rows} 数组） */
async function makeWorkbookMulti(file, sheets) {
  await exec(OFFICECLI, ['create', file]);
  const cmds = [{ command: 'set', path: '/sheet[1]', props: { name: sheets[0].name } }];
  sheets.forEach((s, si) => {
    if (si > 0) cmds.push({ command: 'add', parent: '/', type: 'sheet', props: { name: s.name } });
    s.rows.forEach((row, ri) => {
      row.forEach((value, ci) => {
        cmds.push({
          command: 'add', parent: `/${s.name}`, type: 'cell',
          props: { ref: `${String.fromCharCode(65 + ci)}${ri + 1}`, value: String(value) }
        });
      });
    });
  });
  await execBatch(OFFICECLI, file, cmds);
  await exec(OFFICECLI, ['save', file]);
}

/** 读取 xlsx 全部单元格，按 引用 → 文本 映射返回 */
async function readCells(file) {
  const out = JSON.parse(await exec(OFFICECLI, ['get', file, '/', '--json']));
  const map = {};
  for (const sheet of out.data.results[0].children || []) {
    for (const row of sheet.children || []) {
      for (const cell of row.children || []) {
        const ref = String(cell.path || '').split(/[\\/]/).pop();
        if (ref) map[ref] = cell.text;
      }
    }
  }
  return map;
}

/** 读取 xlsx 指定 sheet 的单元格格式映射（引用 → format） */
async function readCellFormats(file, sheetPath = '/') {
  const out = JSON.parse(await exec(OFFICECLI, ['get', file, sheetPath, '--json']));
  const map = {};
  const sheet = out.data.results[0].type === 'sheet' ? out.data.results[0] : out.data.results[0];
  for (const row of sheet.children || []) {
    for (const cell of row.children || []) {
      const ref = String(cell.path || '').split(/[\\/]/).pop();
      if (ref) map[ref] = cell.format || {};
    }
  }
  return map;
}

/** 创建 docx：按段落文本数组生成 */
async function makeDocx(file, paragraphs, headerText) {
  await exec(OFFICECLI, ['create', file]);
  const cmds = paragraphs.map((text) => ({ command: 'add', parent: '/', type: 'paragraph', props: { text } }));
  if (headerText) cmds.push({ command: 'add', parent: '/', type: 'header', props: { text: headerText } });
  await execBatch(OFFICECLI, file, cmds);
  await exec(OFFICECLI, ['save', file]);
}

/** 读取 docx 正文段落文本（含表格内段落；与工具同源使用 query paragraph，排除页眉页脚） */
async function readDocxTexts(file) {
  const out = JSON.parse(await exec(OFFICECLI, ['query', file, 'paragraph', '--json']));
  return (out.data.results || [])
    .filter((p) => p.type === 'paragraph' && p.path && p.path.startsWith('/body/'))
    .map((p) => String(p.text == null ? '' : p.text));
}

/** 创建 pptx：slides = [{ title, body }]（title 生成标题占位，body 生成文本框） */
async function makePresentation(file, slides) {
  await exec(OFFICECLI, ['create', file]);
  const cmds = slides.map((s) => ({ command: 'add', parent: '/', type: 'slide', props: { title: s.title } }));
  await execBatch(OFFICECLI, file, cmds);
  const content = [];
  slides.forEach((s, i) => {
    if (s.body) {
      content.push({
        command: 'add', parent: `/slide[${i + 1}]`, type: 'textbox',
        props: { text: s.body, x: '2cm', y: '4cm', width: '20cm', height: '8cm' }
      });
    }
    if (s.notes) {
      content.push({ command: 'add', parent: `/slide[${i + 1}]`, type: 'notes', props: { text: s.notes } });
    }
  });
  if (content.length) await execBatch(OFFICECLI, file, content);
  await exec(OFFICECLI, ['save', file]);
}

/** 读取 pptx 全部幻灯片（含 title/textbox 文本、notes），返回 [{ path, title, texts, notes }] */
async function readPptxSlides(file) {
  const out = JSON.parse(await exec(OFFICECLI, ['query', file, 'slide', '--json']));
  const slides = [];
  for (const s of out.data.results || []) {
    if (s.type !== 'slide') continue;
    const title = s.preview || '';
    const texts = [];
    for (const ch of s.children || []) {
      if (ch.type === 'textbox') texts.push(String(ch.text == null ? '' : ch.text));
    }
    slides.push({ path: s.path, title, texts });
  }
  return slides;
}

/** 读取 pptx 全部备注文本 [{ path, text }] */
async function readPptxNotes(file) {
  const out = JSON.parse(await exec(OFFICECLI, ['query', file, 'notes', '--json']));
  return (out.data.results || [])
    .filter((n) => n.type === 'notes')
    .map((n) => ({ path: n.path, text: String(n.text == null ? '' : n.text) }));
}

/** 释放 officecli 文件锁（测试末尾调用） */
function releaseOfficeCli() {
  try {
    require('node:child_process').execSync('taskkill /IM officecli.exe /F', { stdio: 'ignore' });
  } catch (_) { /* 无残留进程时忽略 */ }
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

module.exports = {
  OFFICECLI, TOOLS_ROOT,
  exec, execBatch,
  makeWorkbook, makeWorkbookMulti, readCells, readCellFormats,
  makeDocx, readDocxTexts,
  makePresentation, readPptxSlides, readPptxNotes,
  releaseOfficeCli, removeDir
};

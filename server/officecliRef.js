/**
 * officecli 能力索引：从 `officecli help all --jsonl` 生成紧凑文本（约 3KB），
 * 随系统指令注入给智能体，减少对 officecli_help 的重复全量查询。
 * 缓存到 server/runtime/，officecli 二进制变化时自动重建。
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const config = require('./config.js');
const CACHE_DIR = path.join(config.ROOT, 'server', 'runtime');
const CACHE_FILE = path.join(CACHE_DIR, 'officecli-ref.json');

/** 解析 officecli help all --jsonl，构建每个格式的元素 + 支持操作（ops）清单 */
function buildRef(officecliPath) {
  const raw = cp.execFileSync(officecliPath, ['help', 'all', '--jsonl'], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
  });
  const byFormat = {};
  let legend = '';
  for (const line of raw.split(/\r?\n/)) {
    let j;
    try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.kind === 'meta' && j.ops_legend) {
      legend = Object.entries(j.ops_legend).map(([k, v]) => `${k}=${v}`).join(' ');
    }
    if (j.kind === 'ELEM' && j.format && j.element) {
      (byFormat[j.format] ||= []).push({ element: j.element, ops: j.ops || '' });
    }
  }
  const lines = ['【officecli 能力索引】ops 图例：' + legend +
    '。各元素的路径/属性/示例等细节，用 officecli_help 查询，勿重复全量查询。'];
  for (const [format, elems] of Object.entries(byFormat)) {
    lines.push(`格式 ${format}：`);
    for (const e of elems.sort((a, b) => (a.element < b.element ? -1 : 1))) {
      lines.push(`  ${e.element}（${e.ops}）`);
    }
  }
  return lines.join('\n');
}

/** 获取能力索引文本（缓存命中直接返回；officecli 不存在时返回空串） */
function getOfficecliRef(officecliPath) {
  let key = '';
  try {
    const st = fs.statSync(officecliPath);
    key = `${st.size}-${st.mtimeMs}`;
  } catch (_) {
    return ''; // officecli 未配置
  }
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cached.key === key && typeof cached.text === 'string') return cached.text;
    }
  } catch (_) { /* 缓存缺失或损坏则重建 */ }
  const text = buildRef(officecliPath);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ key, text }));
  } catch (_) { /* 写缓存失败不影响使用 */ }
  return text;
}

module.exports = { getOfficecliRef, buildRef };

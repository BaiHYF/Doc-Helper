/**
 * Doc-Helper 单文件 EXE（Node SEA）入口。
 *
 * SEA 内嵌 main 默认只能加载 built-in 模块，因此本文件只做薄壳：
 *  1) 子进程运行器：toolRunner 以 `Doc-Helper.exe --toolrunner <tool.js>` 调用时，
 *     从数据目录加载 nodeToolRunner.js（复用其 stdin JSON 契约）。
 *  2) 主进程：把内嵌 assets（web/tools/vendor/docs/server）释放到数据目录，
 *     设置 DOC_HELPER_HOME 后用 createRequire 从磁盘加载原有 server/index.js。
 *
 * 数据目录选择：DOC_HELPER_HOME > %LOCALAPPDATA%/Doc-Helper > exe 同目录 Doc-Helper-data。
 */
const fs = require('node:fs');
const path = require('node:path');

// ---- 子进程运行器模式：--toolrunner <tool.js> ----
if (process.argv[2] === '--toolrunner') {
  // SEA 中 argv 偏移与普通 node 不同（argv[1] 重复 execPath），工具路径经环境变量传递
  process.env.SEA_TOOL_PATH = process.argv[3] || '';
  const home = resolveHome();
  const { createRequire } = require('node:module');
  createRequire(path.join(home, 'server', 'index.js'))('./nodeToolRunner.js');
  return;
}

// ---- 主进程 ----
main();

function main() {
  const home = resolveHome();
  ensureReleased(home);
  // 让释放后的 config.js 以数据目录为根（其 ROOT = home/server/.. = home）
  process.env.DOC_HELPER_HOME = home;
  const { createRequire } = require('node:module');
  const requireFromDisk = createRequire(path.join(home, 'server', 'index.js'));
  requireFromDisk('./index.js');
}

function resolveHome() {
  if (process.env.DOC_HELPER_HOME) return path.resolve(process.env.DOC_HELPER_HOME);
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'Doc-Helper');
  return path.join(path.dirname(process.execPath), 'Doc-Helper-data');
}

/** 把内嵌 assets 释放到数据目录；版本戳一致且主入口存在时跳过（加速二次启动） */
function ensureReleased(home) {
  let isSea = false;
  let getAsset = null;
  try {
    ({ isSea, getAsset } = require('node:sea'));
  } catch (_) { /* 非 SEA 环境 */ }
  if (!isSea || typeof getAsset !== 'function') return; // 开发模式下直接用磁盘目录

  fs.mkdirSync(home, { recursive: true });
  const versionFile = path.join(home, '.sea-version');
  const manifest = JSON.parse(Buffer.from(getAsset('sea-manifest.json')).toString('utf8'));

  let current = null;
  try { current = fs.readFileSync(versionFile, 'utf8'); } catch (_) { /* 首次运行 */ }

  if (current === manifest.version && fs.existsSync(path.join(home, 'web', 'index.html'))) {
    return;
  }

  // 版本变化时清掉旧资产目录，避免残留旧工具/旧文件
  for (const dir of ['web', 'tools', 'vendor', 'docs', 'server']) {
    fs.rmSync(path.join(home, dir), { recursive: true, force: true });
  }

  for (const name of manifest.files || []) {
    const target = path.join(home, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(getAsset(name)));
  }

  fs.writeFileSync(versionFile, manifest.version);
}

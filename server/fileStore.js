const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * 任务文件存储：为每次 run 创建独立的上传/结果目录，
 * 并把上传文件落盘、把工具参数中的 @uploads/@results 占位符解析为真实路径。
 */
class FileStore {
  constructor(runtimeDir) {
    this.tasksDir = path.join(runtimeDir, 'tasks');
    fs.mkdirSync(this.tasksDir, { recursive: true });
  }

  createTask() {
    const id = crypto.randomBytes(6).toString('hex');
    const dir = path.join(this.tasksDir, id);
    const uploadsDir = path.join(dir, 'uploads');
    const resultsDir = path.join(dir, 'results');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });
    return { id, dir, uploadsDir, resultsDir };
  }

  /** files: [{ name, base64 }] */
  saveFiles(task, files = []) {
    for (const f of files) {
      if (!f || typeof f.name !== 'string' || typeof f.base64 !== 'string') continue;
      const safe = path.basename(f.name);
      fs.writeFileSync(path.join(task.uploadsDir, safe), Buffer.from(f.base64, 'base64'));
    }
  }

  /** 把参数值中的 @uploads / @results 占位符替换为任务目录真实路径 */
  resolveArgs(args = {}, uploadsDir, resultsDir) {
    const out = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        out[key] = value
          .split('@uploads').join(uploadsDir)
          .split('@results').join(resultsDir);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /** 结果文件下载路径（带目录穿越防护） */
  resultFilePath(taskId, fileName) {
    const base = path.resolve(this.tasksDir, taskId, 'results');
    const full = path.resolve(base, fileName);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return full;
  }
}

module.exports = { FileStore };

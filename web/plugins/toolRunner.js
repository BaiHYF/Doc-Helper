/* 插件：工具调用页（拖放上传、运行、结果下载） */
import { api, $, escapeHtml, on, emit } from '../core.js';

let currentTool = null;
let currentTask = null;
let taskEventSource = null;
let selectedFiles = [];
let _ctx = null;

/* 参数中文标签（普通用户看不懂 inputFile/output 这类英文名） */
const PARAM_LABELS = {
  inputFile: '输入文件',
  inputDir: '输入文件',
  output: '输出文件',
  outputDir: '输出目录',
  preset: '预置模板',
  mapping: '替换规则',
  dedupe: '去除重复行',
  trimCells: '去除首尾空格',
  removeEmptyRows: '删除空行',
  removeDupRows: '去除重复行',
  titleCaseCol: '统一大小写的列',
  fillEmpty: '空值填充',
  convertNums: '数字文本转数字',
  autofit: '自动列宽',
  headerStyle: '表头样式',
  align: '对齐方式',
  numberFormat: '数字格式',
  freezeRow: '冻结行数'
};
function paramLabel(name, prop) {
  if (PARAM_LABELS[name]) return PARAM_LABELS[name];
  if (prop && prop.output === true) return '输出文件';
  if (prop && prop.type === 'file') return '输入文件';
  return name;
}

/* 参数分类 */
function paramKind(prop) {
  if (prop && prop.type === 'file') return 'file';
  if (prop && prop.output === true) return 'output';
  return 'text';
}

/* 文件格式工具 */
function acceptAttr(accept) {
  if (!accept?.length) return '';
  return accept.map((e) => '.' + e).join(',');
}
function acceptLabel(accept) {
  if (!accept?.length) return '';
  return '，支持 ' + accept.map((e) => '.' + e).join('、');
}
function defaultOutputExt(accept) {
  if (!accept?.length) return '';
  return accept[0];
}
function isAccepted(fileName, accept) {
  const ext = fileName.toLowerCase().split('.').pop();
  return accept.includes(ext);
}
function inputRequirementText(inputFiles) {
  const min = inputFiles?.min ?? 0;
  const max = inputFiles?.max ?? null;
  if (max === null) {
    if (min > 1) return `至少 ${min} 个文件`;
    if (min === 1) return '1 个或多个文件';
    return '任意数量';
  }
  if (min === max) return `恰好 ${min} 个文件`;
  if (min === 0) return `最多 ${max} 个文件`;
  return `${min}～${max} 个文件`;
}

let dropErrorTimer = null;
function showDropError(msg) {
  const el = $('#drop-error');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(dropErrorTimer);
  dropErrorTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

function renderDropList() {
  const list = $('#drop-list');
  if (!list) return;
  const count = $('#drop-count');
  if (count) count.textContent = selectedFiles.length ? `已选 ${selectedFiles.length} 个文件` : '';
  list.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'drop-item';
    item.innerHTML = `<span class="fname">${escapeHtml(f.name)}</span><button class="frm" title="移除">×</button>`;
    item.querySelector('.frm').onclick = (e) => {
      e.stopPropagation();
      selectedFiles.splice(i, 1);
      renderDropList();
      validate();
    };
    list.appendChild(item);
  });
}

function addFiles(fileList) {
  const accept = currentTool?.accept || [];
  let rejected = 0;
  for (const f of Array.from(fileList)) {
    if (selectedFiles.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (accept.length && !isAccepted(f.name, accept)) { rejected++; continue; }
    selectedFiles.push(f);
  }
  renderDropList();
  validate();
  if (rejected > 0) {
    showDropError(`已忽略 ${rejected} 个文件：仅支持 ${accept.map((e) => '.' + e).join('、')} 格式`);
  }
}

/* 校验：文件数 + 必填文本参数 */
function validate() {
  if (!currentTool) return;
  const params = currentTool.parameters?.properties || {};
  const required = currentTool.parameters?.required || [];
  const hasInput = Object.keys(params).some((n) => paramKind(params[n]) === 'file');

  let ok = true;
  if (hasInput) {
    const min = currentTool.inputFiles?.min ?? 0;
    const max = currentTool.inputFiles?.max ?? null;
    if (selectedFiles.length < min) ok = false;
    if (max !== null && selectedFiles.length > max) ok = false;
  }
  for (const name of required) {
    if (paramKind(params[name]) === 'file') continue;
    const input = document.querySelector(`.text-input[data-param="${name}"]`);
    if (input && !input.value.trim()) ok = false;
  }
  $('#run-btn').disabled = !ok;
}

function collectPayload() {
  const args = {};
  document.querySelectorAll('.text-input[data-param]').forEach((text) => {
    args[text.dataset.param] = text.value.trim();
  });
  const params = currentTool.parameters?.properties || {};
  for (const name of Object.keys(params)) {
    if (paramKind(params[name]) === 'file') args[name] = '@uploads';
  }
  return { files: selectedFiles, args };
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function stopPolling() {
  if (taskEventSource) { taskEventSource.close(); taskEventSource = null; }
  $('#cancel-btn').classList.add('hidden');
  validate();
}

function showResult(result) {
  $('#run-progress').classList.add('hidden');
  $('#run-result').classList.remove('hidden');
  const files = result.outputFiles || [];
  const links = files.map((f) => {
    const name = f.split(/[\\/]/).pop();
    return `<a class="download" href="/api/files/${currentTask}/${encodeURIComponent(name)}">⬇ ${escapeHtml(name)}</a>`;
  }).join(' ');
  $('#run-result').innerHTML = `
    <div class="result-ok">✓ ${escapeHtml(result.summary || '处理完成')}</div>
    <div class="result-links">${links || '<span>（无输出文件）</span>'}</div>`;
  currentTask = null;
}

function showError(msg) {
  $('#run-progress').classList.add('hidden');
  $('#run-result').classList.remove('hidden');
  $('#run-result').innerHTML = `<div class="result-err">✗ ${escapeHtml(msg)}</div>`;
  currentTask = null;
}

function subscribeTaskEvents(taskId) {
  const es = new EventSource(`/api/tools/${encodeURIComponent(currentTool.name)}/run/${taskId}/events`);
  taskEventSource = es;

  es.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    if (d.progress) $('#run-progress').textContent = d.progress;
  });
  es.addEventListener('done', (e) => {
    const d = JSON.parse(e.data);
    stopPolling();
    showResult(d.result);
  });
  es.addEventListener('failed', (e) => {
    const d = JSON.parse(e.data);
    stopPolling();
    showError(d.error || '执行失败');
  });
  es.addEventListener('cancelled', () => {
    stopPolling();
    showError('任务已取消');
  });
  es.onerror = () => {
    if (currentTask) poll();
  };
}

async function poll() {
  const r = await api.status(currentTool.name, currentTask);
  if (r.status === 'done') {
    stopPolling();
    showResult(r.result);
  } else if (r.status === 'error' || r.status === 'cancelled') {
    stopPolling();
    showError(r.error || (r.status === 'cancelled' ? '任务已取消' : '执行失败'));
  } else {
    $('#run-progress').textContent = r.progress || '处理中…';
    setTimeout(poll, 1000);
  }
}

async function startRun() {
  const { files: fileRefs, args } = collectPayload();
  const files = [];
  for (const ref of fileRefs) {
    files.push({ name: ref.name, base64: await readAsBase64(ref) });
  }
  $('#run-progress').classList.remove('hidden');
  $('#run-progress').textContent = '正在启动…';
  $('#run-btn').disabled = true;
  $('#cancel-btn').classList.remove('hidden');

  const r = await api.run(currentTool.name, { files, args });
  if (r.error) {
    showError(r.error);
    return;
  }
  currentTask = r.taskId;
  subscribeTaskEvents(currentTask);
}

/** 打开工具调用页 */
function openTool(tool) {
  currentTool = tool;
  currentTask = null;
  selectedFiles = [];
  emit('view:tool', tool);

  $('#view-root').classList.add('hidden');
  $('#call-view').classList.remove('hidden');
  $('#call-title').textContent = tool.title || tool.name;
  const tags = (tool.categories || []).map((c) => escapeHtml(c)).join(' · ');
  $('#call-desc').innerHTML = `${escapeHtml(tool.description)}` +
    (tags ? `<span class="call-tags">${tags}</span>` : '');
  $('#param-fields').innerHTML = '';
  $('#run-result').classList.add('hidden');
  $('#run-progress').classList.add('hidden');

  const params = tool.parameters?.properties || {};
  const required = tool.parameters?.required || [];
  const hasInput = Object.keys(params).some((n) => paramKind(params[n]) === 'file');

  // 文件拖放区
  if (hasInput) {
    const zone = document.createElement('div');
    zone.className = 'drop-zone';
    const acceptStr = acceptAttr(tool.accept);
    zone.innerHTML = `
      <input type="file" id="drop-input" multiple class="hidden"${acceptStr ? ` accept="${acceptStr}"` : ''}>
      <div class="drop-hint"><strong>拖拽文件到这里</strong>，或点击选择文件（${inputRequirementText(tool.inputFiles)}${acceptLabel(tool.accept)}）</div>
      <div class="drop-count" id="drop-count"></div>
      <div class="drop-error" id="drop-error"></div>
      <div class="drop-list" id="drop-list"></div>`;
    $('#param-fields').appendChild(zone);

    const input = zone.querySelector('#drop-input');
    zone.addEventListener('click', (e) => {
      if (e.target !== input) input.click();
    });
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
  }

  // 非 file 参数：output 与其它文本参数
  for (const [name, prop] of Object.entries(params)) {
    if (paramKind(prop) === 'file') continue;
    const isRequired = required.includes(name);
    const isOutput = paramKind(prop) === 'output';
    const label = paramLabel(name, prop);
    const field = document.createElement('div');
    field.className = 'param';
    field.innerHTML = `
      <label>${escapeHtml(label)}<span class="req">${isRequired ? ' *' : ''}</span></label>
      <div class="hint">${escapeHtml(prop.description || '')}</div>`;
    if (isOutput) {
      const ext = defaultOutputExt(tool.accept);
      const base = (tool.title || tool.name).replace(/[\\/:*?"<>|]/g, '');
      const def = `@results/${base}${ext ? '.' + ext : ''}`;
      field.innerHTML += `<input type="text" class="text-input" data-param="${name}" value="${def}">`;
    } else {
      field.innerHTML += `<input type="text" class="text-input" data-param="${name}">`;
    }
    field.querySelector('.text-input').addEventListener('input', validate);
    $('#param-fields').appendChild(field);
  }

  $('#run-btn').onclick = startRun;
  $('#cancel-btn').onclick = async () => {
    if (currentTask) await api.cancel(currentTool.name, currentTask);
  };

  validate();
}

/** 返回主界面 */
function goHome() {
  stopPolling();
  currentTool = null;
  $('#call-view').classList.add('hidden');
  $('#view-root').classList.remove('hidden');
  emit('nav:change', _ctx.state.nav);
}

export default {
  name: 'toolRunner',
  mount(ctx) {
    _ctx = ctx;
    this._onOpen = (t) => openTool(t);
    this._onHome = () => goHome();
    on('tool:open', this._onOpen);
    on('view:home', this._onHome);
    $('#call-back').onclick = goHome;
  },
  unmount() {
    off('tool:open', this._onOpen);
    off('view:home', this._onHome);
  }
};
/* 插件：智能体聊天侧边栏 */
import { api, $, escapeHtml, on, emit } from '../core.js';

const chatHistory = [];
let chatting = false;

function toggleChat() {
  const panel = $('#chat-panel');
  const closed = panel.classList.toggle('closed');
  $('#chat-toggle').textContent = closed ? '💬 智能体' : '✕';
}

function scrollChat() {
  const box = $('#chat-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function addChatMsg(role, html) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg ' + role;
  msg.innerHTML = html;
  const box = $('#chat-messages');
  const empty = box?.querySelector('.chat-empty');
  if (empty) empty.remove();
  box?.appendChild(msg);
  scrollChat();
  return msg;
}

function renderDraftCard(draft, container) {
  const card = document.createElement('div');
  card.className = 'chat-draft';
  card.innerHTML = `
    <div class="chat-draft-title">✨ 已生成新工具草稿（启用后才会生效）</div>
    <div class="chat-draft-name">${escapeHtml(draft.name)}</div>
    <div class="chat-draft-desc">${escapeHtml(draft.description || '')}</div>
    <button class="btn primary" data-draft-enable>启用</button>`;
  card.querySelector('[data-draft-enable]').onclick = async () => {
    const r = await api.enable(draft.name, true);
    if (r.ok) {
      card.innerHTML = '<div class="chat-draft-title" style="color:var(--green)">✓ 已启用，可在"工具列表"找到并调用</div>';
      emit('tools:refresh');
    } else {
      card.innerHTML = `<div class="chat-draft-title" style="color:var(--red)">✗ 启用失败：${escapeHtml(r.error || '未知错误')}</div>`;
    }
  };
  container.appendChild(card);
}

function renderPluginDraftCard(draft, container) {
  const card = document.createElement('div');
  card.className = 'chat-draft';
  card.innerHTML = `
    <div class="chat-draft-title">✨ 已生成新插件草稿（启用后需刷新页面生效）</div>
    <div class="chat-draft-name">${escapeHtml(draft.name || draft.file)}</div>
    <div class="chat-draft-desc">${escapeHtml(draft.description || '')}</div>
    <button class="btn primary" data-draft-enable>启用</button>`;
  card.querySelector('[data-draft-enable]').onclick = async () => {
    const r = await api.enablePlugin(draft.file, true);
    if (r.ok) {
      card.innerHTML = '<div class="chat-draft-title" style="color:var(--green)">✓ 已启用，刷新页面后生效</div>';
      emit('plugins:refresh');
    } else {
      card.innerHTML = `<div class="chat-draft-title" style="color:var(--red)">✗ 启用失败：${escapeHtml(r.error || '未知错误')}</div>`;
    }
  };
  container.appendChild(card);
}

function handleChatEvent(rawEvent, assistant) {
  let event = '';
  let data = '';
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  if (!event || !data) return;
  let d;
  try { d = JSON.parse(data); } catch (_) { return; }

  switch (event) {
    case 'text':
      assistant.innerHTML += escapeHtml(d.text);
      scrollChat();
      break;
    case 'tool_call':
      assistant.innerHTML += `<div class="chat-tool">🔧 正在调用工具 <b>${escapeHtml(d.name)}</b>…</div>`;
      scrollChat();
      break;
    case 'tool_result':
      if (d.ok) {
        const summary = d.result && d.result.summary ? d.result.summary : '完成';
        assistant.innerHTML += `<div class="chat-tool">✅ ${escapeHtml(summary)}</div>`;
      } else {
        assistant.innerHTML += `<div class="chat-tool err">❌ ${escapeHtml(d.error || '工具执行失败')}</div>`;
      }
      scrollChat();
      break;
    case 'draft_tool':
      renderDraftCard(d, assistant);
      scrollChat();
      break;
    case 'draft_plugin':
      renderPluginDraftCard(d, assistant);
      scrollChat();
      break;
    case 'failed':
      assistant.innerHTML += `<div class="chat-tool err">❌ ${escapeHtml(d.error || '出错了')}</div>`;
      scrollChat();
      break;
  }
}

async function sendChat() {
  const text = $('#chat-text').value.trim();
  if (!text || chatting) return;
  $('#chat-text').value = '';
  chatHistory.push({ role: 'user', content: text });
  addChatMsg('user', escapeHtml(text));

  const assistant = addChatMsg('assistant', '');
  chatting = true;
  $('#chat-send').disabled = true;
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `请求失败（${resp.status}）`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleChatEvent(event, assistant);
      }
    }
    chatHistory.push({ role: 'assistant', content: assistant.textContent || '' });
  } catch (e) {
    assistant.innerHTML += `<div class="chat-tool err">✗ ${escapeHtml(e.message)}</div>`;
  } finally {
    chatting = false;
    $('#chat-send').disabled = false;
    scrollChat();
  }
}

export default {
  name: 'chatSidebar',
  mount() {
    $('#chat-toggle').onclick = toggleChat;
    $('#chat-close').onclick = () => {
      $('#chat-panel').classList.add('closed');
      $('#chat-toggle').textContent = '💬 智能体';
    };
    $('#chat-send').onclick = sendChat;
    $('#chat-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  },
  unmount() {
    $('#chat-toggle').onclick = null;
    $('#chat-close').onclick = null;
    $('#chat-send').onclick = null;
    $('#chat-text').replaceWith($('#chat-text').cloneNode(true));
  }
};
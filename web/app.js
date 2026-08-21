/* Doc-Helper 前端入口：从服务端发现插件并动态加载（支持智能体生成的新插件） */
import { createCtx } from './core.js';

const ctx = createCtx();

async function loadPlugin(p) {
  try {
    const mod = await import(`/plugins/${p.file}`);
    const inst = mod.default || mod;
    if (typeof inst.mount !== 'function') {
      console.warn(`[plugin] ${p.name} 缺少 mount 方法，跳过`);
      return;
    }
    inst.mount(ctx);
    console.log(`[plugin] ${p.name} 已加载`);
  } catch (e) {
    console.error(`[plugin] ${p.name} 加载失败:`, e);
  }
}

async function boot() {
  let plugins = [];
  try {
    const r = await fetch('/api/plugins');
    plugins = (await r.json()).plugins || [];
  } catch (e) {
    console.error('[plugin] 获取插件清单失败:', e);
    return;
  }
  for (const p of plugins) {
    if (!p.enabled) continue;
    await loadPlugin(p);
  }
}

boot();

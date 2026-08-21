/* Doc-Helper 前端入口：加载插件，启动应用 */
import { createCtx } from './core.js';
import toolList from './plugins/toolList.js';
import toolRunner from './plugins/toolRunner.js';
import chatSidebar from './plugins/chatSidebar.js';
import settings from './plugins/settings.js';

const ctx = createCtx();

const plugins = [toolList, toolRunner, chatSidebar, settings];

for (const p of plugins) {
  try {
    p.mount(ctx);
    console.log(`[plugin] ${p.name} 已加载`);
  } catch (e) {
    console.error(`[plugin] ${p.name} 加载失败:`, e);
  }
}
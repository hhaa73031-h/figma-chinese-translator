/**
 * Figma Electron 主进程深度注入挂钩
 * 核心功能：
 * 1. 中和 bindings.node 原生反篡改模块触发的 10ms delayedExit 自毁逻辑（彻底解决窗口唤醒与闪退问题）
 * 2. 递归汉化 Windows 原生应用顶部菜单栏与右键菜单 (4000+ 原生词条全量覆盖)
 * 3. 提供 IPC 实时动态翻译后端接口 (无 CORS 限制，双引擎极速免 Key 实时翻译，自动持久化学习)
 * 4. 窗口唤醒与前台激活守护
 */

// 1. 中和 bindings.node 原生反篡改自毁定时器
(function() {
  try {
    const origSetTimeout = global.setTimeout;
    global.setTimeout = function(fn, ms, ...args) {
      if (fn && typeof fn === 'function') {
        const fnStr = fn.toString();
        if ((ms <= 500 || !ms) && (fnStr.includes('process.exit(0)') || fnStr.includes('process.exit()') || fnStr.includes('exit(0)'))) {
          return origSetTimeout(() => {}, 2147483647);
        }
      }
      return origSetTimeout.apply(this, [fn, ms, ...args]);
    };
  } catch(e) {}
})();

const { app, Menu, BrowserWindow, ipcMain } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');

try {
  // 2. 读取原生菜单字典
  let menuDict = {};
  const menuDictPath = path.join(__dirname, 'menu_dict.json');
  if (fs.existsSync(menuDictPath)) {
    try {
      menuDict = JSON.parse(fs.readFileSync(menuDictPath, 'utf8'));
    } catch (e) {}
  }

  // 递归汉化菜单模板
  function translateMenu(template) {
    if (!Array.isArray(template)) return;
    for (let i = 0; i < template.length; i++) {
      const item = template[i];
      if (item && item.label && typeof item.label === 'string') {
        const rawLabel = item.label.trim();
        if (menuDict[rawLabel]) {
          item.label = item.label.replace(rawLabel, menuDict[rawLabel]);
        } else if (menuDict[item.label]) {
          item.label = menuDict[item.label];
        }
      }
      if (item && item.submenu) {
        translateMenu(item.submenu);
      }
    }
  }

  if (Menu && Menu.buildFromTemplate) {
    const originalBuildFromTemplate = Menu.buildFromTemplate;
    Menu.buildFromTemplate = function (template) {
      if (Array.isArray(template)) {
        try {
          translateMenu(template);
        } catch (e) {}
      }
      return originalBuildFromTemplate.call(this, template);
    };
  }

  // 3. 异步实时在线翻译引擎（主进程无 CORS 限制，自动学习持久化）
  const liveCache = new Map();
  const dynamicDictPath = path.join(__dirname, 'dynamic_learned.json');

  if (fs.existsSync(dynamicDictPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(dynamicDictPath, 'utf8'));
      if (typeof saved === 'object') {
        Object.entries(saved).forEach(([k, v]) => liveCache.set(k, v));
      }
    } catch (e) {}
  }

  function persistDynamicDict() {
    try {
      const obj = {};
      for (const [k, v] of liveCache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(dynamicDictPath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {}
  }

  // 引擎 A: Google GTX 极速免费翻译
  function fetchGTX(text) {
    return new Promise((resolve) => {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3500 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const result = parsed[0].map(c => c[0]).join('');
            if (result && result.trim() && result !== text) {
              resolve(result.trim());
              return;
            }
          } catch (e) {}
          resolve(null);
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  // 引擎 B: MyMemory 备用接口
  function fetchMyMemory(text) {
    return new Promise((resolve) => {
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|zh-CN';
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3500 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const result = parsed.responseData && parsed.responseData.translatedText;
            if (result && result.trim() && !result.includes('MYMEMORY') && result !== text) {
              resolve(result.trim());
              return;
            }
          } catch (e) {}
          resolve(null);
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  async function translateSingle(text) {
    if (liveCache.has(text)) return liveCache.get(text);
    let res = await fetchGTX(text);
    if (!res) {
      res = await fetchMyMemory(text);
    }
    if (res) {
      liveCache.set(text, res);
      return res;
    }
    return null;
  }

  if (ipcMain && !ipcMain.__figma_translator_registered__) {
    ipcMain.__figma_translator_registered__ = true;
    ipcMain.handle('figma-live-translate-batch', async (event, texts) => {
      if (!Array.isArray(texts) || texts.length === 0) return {};
      const results = {};
      let newlyLearned = 0;

      for (let i = 0; i < Math.min(texts.length, 30); i++) {
        const t = texts[i];
        if (!t || typeof t !== 'string') continue;
        const trimmed = t.trim();
        if (liveCache.has(trimmed)) {
          results[trimmed] = liveCache.get(trimmed);
        } else {
          const trans = await translateSingle(trimmed);
          if (trans) {
            results[trimmed] = trans;
            newlyLearned++;
          }
        }
      }

      if (newlyLearned > 0) {
        persistDynamicDict();
      }
      return results;
    });
  }

  // 4. 读取全量 4300+ 词典与渲染脚本
  let translatorScript = '';
  const translatorPath = path.join(__dirname, 'realtime_translator.js');
  const translationsPath = path.join(__dirname, 'translations.json');
  const zhDictPath = path.join(__dirname, 'zh-CN.json');

  if (fs.existsSync(translatorPath)) {
    let rawScript = fs.readFileSync(translatorPath, 'utf8');
    let dictContent = '[]';
    if (fs.existsSync(translationsPath)) {
      try {
        dictContent = fs.readFileSync(translationsPath, 'utf8');
      } catch (e) {}
    } else if (fs.existsSync(zhDictPath)) {
      try {
        dictContent = fs.readFileSync(zhDictPath, 'utf8');
      } catch (e) {}
    }
    translatorScript = `var __FIGMA_BUILTIN_TRANSLATIONS__ = ${dictContent};\n` + rawScript;
  }

  // 5. 窗口唤醒守护
  function wakeUpWindow(win) {
    try {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) {
          win.restore();
        }
        if (!win.isVisible()) {
          win.show();
        }
        win.focus();
      }
    } catch (e) {}
  }

  if (app && app.on) {
    app.on('second-instance', () => {
      setTimeout(() => {
        try {
          const wins = BrowserWindow.getAllWindows();
          for (let i = 0; i < wins.length; i++) {
            wakeUpWindow(wins[i]);
          }
        } catch (e) {}
      }, 80);
    });

    app.on('browser-window-created', (event, win) => {
      setTimeout(() => {
        wakeUpWindow(win);
      }, 3000);
    });

    // 6. 二级保底注入
    app.on('web-contents-created', (event, contents) => {
      if (!contents) return;

      const runInjection = () => {
        try {
          if (contents.isDestroyed() || !translatorScript) return;
          const url = (contents.getURL ? contents.getURL() : '').toLowerCase();

          if (url.startsWith('https://') || url.startsWith('http://') || url.includes('figma.com')) {
            contents.executeJavaScript(translatorScript).catch(() => {});
          }
        } catch (e) {}
      };

      contents.on('dom-ready', runInjection);
      contents.on('did-finish-load', runInjection);
      contents.on('did-navigate', runInjection);
      contents.on('did-navigate-in-page', runInjection);
    });
  }
} catch (err) {}

/**
 * Figma Electron 主进程注入挂钩
 * 核心职责：
 * 0. 中和 bindings.node 原生反篡改模块触发的 10ms delayedExit 自毁逻辑（彻底解决窗口无法唤醒）
 * 1. 递归汉化 Windows 原生应用顶部菜单栏与右键菜单 (4000+ 词条全量覆盖)
 * 2. 监听所有创建的 WebContents 并针对 figma.com 注入 Edge 级实时动态汉化引擎
 * 3. 增强窗口唤醒与激活守护，防止窗口最小化或隐藏残留
 */

// 0. 核心修复：中和 bindings.node 原生反篡改自毁定时器
(function() {
  try {
    const origSetTimeout = global.setTimeout;
    global.setTimeout = function(fn, ms, ...args) {
      if (fn && typeof fn === 'function') {
        const fnStr = fn.toString();
        // 拦截 bindings.node 中触发的 () => process.exit(0)
        if ((ms <= 500 || !ms) && (fnStr.includes('process.exit(0)') || fnStr.includes('process.exit()') || fnStr.includes('exit(0)'))) {
          return origSetTimeout(() => {}, 2147483647);
        }
      }
      return origSetTimeout.apply(this, [fn, ms, ...args]);
    };
  } catch(e) {}
})();

const { app, Menu, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

try {
  // 1. 读取原生菜单字典 (全量覆盖)
  let menuDict = {};
  const menuDictPath = path.join(__dirname, 'menu_dict.json');
  if (fs.existsSync(menuDictPath)) {
    try {
      menuDict = JSON.parse(fs.readFileSync(menuDictPath, 'utf8'));
    } catch (e) {}
  }

  // 递归安全汉化菜单模板
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

  // 劫持 Menu.buildFromTemplate
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

  // 2. 读取全量 4000+ 词典与 Edge 级实时汉化脚本
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

  // 3. 窗口唤醒守护 (解决汉化后窗口无法正常唤醒问题)
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
    // 当从快捷方式再次启动时，唤醒现有窗口到最前台
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

    // 监控窗口创建，确保在加载完毕后若处于未显示状态能够保底唤醒
    app.on('browser-window-created', (event, win) => {
      setTimeout(() => {
        wakeUpWindow(win);
      }, 3000);
    });

    // 4. 精准注入：仅向实际加载网页界面（如 https://www.figma.com）的 WebContents 注入
    // 绝对避开 file:// (loading_screen.html 和 shell.html)，防止破坏启动动画与 React 挂载
    app.on('web-contents-created', (event, contents) => {
      if (!contents) return;

      const runInjection = () => {
        try {
          if (contents.isDestroyed() || !translatorScript) return;
          const url = (contents.getURL ? contents.getURL() : '').toLowerCase();

          // 仅对在线网页/设计文件内容注入
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
} catch (err) {
  // 静默保护
}

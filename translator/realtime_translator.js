/**
 * Figma 高性能动态实时无感汉化引擎 (High-Performance Realtime Localization Engine)
 * 特性：
 * 1. 0 毫秒本地极速层：4300+ 离线词库 + 智能快捷键剥离 + 动词前缀拆分 + 数量通配符模板
 * 2. 毫秒级在线实时层：通过主进程 IPC 自动探测并翻译未收录的全新英文短语（免代理免Key），实时回填并永久记忆
 * 3. 严格安全沙箱：绝对跳过 SCRIPT/STYLE 代码块与输入框，杜绝 React 运行崩溃，保护用户输入
 * 4. 高性能 rAF 批处理防抖 + MutationObserver 实时响应，主线程 60fps 零卡顿
 */
(function () {
  if (window.__FIGMA_REALTIME_TRANSLATOR_ACTIVE__) return;
  window.__FIGMA_REALTIME_TRANSLATOR_ACTIVE__ = true;

  // 1. 初始化本地词库
  const dataMap = new Map();
  const patternEntries = [];

  const rawData = (typeof __FIGMA_BUILTIN_TRANSLATIONS__ !== 'undefined' && Array.isArray(__FIGMA_BUILTIN_TRANSLATIONS__))
    ? __FIGMA_BUILTIN_TRANSLATIONS__
    : (typeof __FIGMA_BUILTIN_DICT__ !== 'undefined' && __FIGMA_BUILTIN_DICT__)
      ? Object.entries(__FIGMA_BUILTIN_DICT__)
      : [];

  // 合并本地缓存的增量已学习词库
  try {
    const cached = localStorage.getItem('figma_cn_dynamic_dict_v2');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        rawData.push(...parsed);
      } else if (typeof parsed === 'object') {
        Object.entries(parsed).forEach(([k, v]) => rawData.push([k, v]));
      }
    }
  } catch (e) {}

  rawData.forEach((item) => {
    if (!Array.isArray(item) || item.length < 2) return;
    const key = item[0];
    const val = item[1];
    if (!key || !val || dataMap.has(key)) return;

    if (key.includes('{@}') || key.includes('{1}')) {
      const escaped = key
        .replace(/\{@\}/g, '\x00HOLDER\x00')
        .replace(/\{1\}/g, '\x00HOLDER\x00')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\x00HOLDER\x00/g, '(.+)');
      patternEntries.push({ regex: new RegExp('^' + escaped + '$'), template: val });
    } else {
      dataMap.set(key, val);
      const trimmed = key.trim();
      if (!dataMap.has(trimmed)) {
        dataMap.set(trimmed, val);
      }
    }
  });

  // 2. 严格的保护与排除标签列表
  const IGNORE_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'CODE', 'PRE', 'CANVAS', 'SVG', 'PATH', 'G', 'DEFS', 'SYMBOL'
  ]);
  const ATTRS = ['placeholder', 'data-placeholder', 'aria-label', 'title', 'data-tooltip', 'tooltip', 'data-label'];

  function isEditable(el) {
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (
        curr.isContentEditable ||
        (curr.getAttribute && curr.getAttribute('role') === 'textbox') ||
        curr.tagName === 'INPUT' ||
        curr.tagName === 'TEXTAREA' ||
        curr.tagName === 'PRE' ||
        curr.tagName === 'CODE' ||
        (typeof curr.className === 'string' && /monaco|codemirror|editor-input|variable_name/i.test(curr.className))
      ) {
        return true;
      }
      curr = curr.parentElement;
    }
    return false;
  }

  // 常用动词前缀映射表 (智能拆解组合短语)
  const PREFIX_MAP = {
    'New ': '新建 ',
    'Create ': '创建 ',
    'Open ': '打开 ',
    'Show ': '显示 ',
    'Hide ': '隐藏 ',
    'Toggle ': '切换 ',
    'Select ': '选择 ',
    'Add ': '添加 ',
    'Remove ': '移除 ',
    'Delete ': '删除 ',
    'Duplicate ': '复制 ',
    'Rename ': '重命名 ',
    'Copy ': '复制 ',
    'Paste ': '粘贴 ',
    'Export ': '导出 ',
    'Import ': '导入 ',
    'Edit ': '编辑 ',
    'View ': '查看 ',
    'Sort by ': '排序方式：',
    'Filter by ': '筛选条件：',
    'Align ': '对齐 ',
    'Distribute ': '分布 '
  };

  // 3. 核心文本翻译函数 (本地秒级翻译)
  function translateText(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length < 1) return null;

    // 3.1 词典直接命中
    if (dataMap.has(text)) return dataMap.get(text);
    if (dataMap.has(trimmed)) {
      return text.replace(trimmed, dataMap.get(trimmed));
    }

    // 3.2 剥离末尾快捷键 (如 "Auto layout (Shift+A)" -> "自动布局 (Shift+A)")
    const shortcutMatch = trimmed.match(/\s*(\([A-Za-z0-9+ \u2318\u21e7\u2325\u2303\\/_\-]+\))$/);
    if (shortcutMatch) {
      const baseText = trimmed.slice(0, shortcutMatch.index).trim();
      const shortcut = shortcutMatch[1];
      if (dataMap.has(baseText)) {
        const transBase = dataMap.get(baseText);
        return text.replace(trimmed, `${transBase} ${shortcut}`);
      }
    }

    // 3.3 省略号剥离 (如 "Export..." -> "导出...")
    if (trimmed.endsWith('...')) {
      const base = trimmed.slice(0, -3).trim();
      if (dataMap.has(base)) {
        return text.replace(trimmed, `${dataMap.get(base)}...`);
      }
    }

    // 3.4 动态通配符模板匹配 (如：Zoom to 100%, 12 layers selected)
    for (let i = 0; i < patternEntries.length; i++) {
      const { regex, template } = patternEntries[i];
      const match = trimmed.match(regex);
      if (match) {
        let res = template;
        for (let j = 1; j < match.length; j++) {
          res = res.replace(new RegExp(`\\{${j}\\}`, 'g'), match[j]);
          res = res.replace('{@}', match[j]);
        }
        return text.replace(trimmed, res);
      }
    }

    // 3.5 数量与通用规则
    let m = trimmed.match(/^(\d+)\s+layers?\s+selected$/i);
    if (m) return text.replace(trimmed, `${m[1]} 个已选图层`);
    m = trimmed.match(/^(\d+)\s+components?\s+selected$/i);
    if (m) return text.replace(trimmed, `${m[1]} 个已选组件`);
    m = trimmed.match(/^(\d+)\s+objects?$/i);
    if (m) return text.replace(trimmed, `${m[1]} 个对象`);
    m = trimmed.match(/^Page\s+(\d+)$/i);
    if (m) return text.replace(trimmed, `页面 ${m[1]}`);
    m = trimmed.match(/^Frame\s+(\d+)$/i);
    if (m) return text.replace(trimmed, `画框 ${m[1]}`);
    m = trimmed.match(/^Section\s+(\d+)$/i);
    if (m) return text.replace(trimmed, `分区 ${m[1]}`);
    m = trimmed.match(/^Zoom to\s+(\d+%)$/i);
    if (m) return text.replace(trimmed, `缩放至 ${m[1]}`);
    m = trimmed.match(/^(\d+)\s+days?\s+ago$/i);
    if (m) return text.replace(trimmed, `${m[1]} 天前`);
    m = trimmed.match(/^(\d+)\s+hours?\s+ago$/i);
    if (m) return text.replace(trimmed, `${m[1]} 小时前`);
    m = trimmed.match(/^(\d+)\s+minutes?\s+ago$/i);
    if (m) return text.replace(trimmed, `${m[1]} 分钟前`);

    // 3.6 动词前缀智能拆解 (如 "New frame" -> "新建画框")
    for (const [prefix, prefixZh] of Object.entries(PREFIX_MAP)) {
      if (trimmed.startsWith(prefix)) {
        const noun = trimmed.slice(prefix.length).trim();
        if (dataMap.has(noun)) {
          return text.replace(trimmed, prefixZh.trim() + dataMap.get(noun));
        }
      }
    }

    // 3.7 冒号键值对翻译 (如 "Align: Center" 或 "Opacity: 100%")
    if (trimmed.includes(': ')) {
      const parts = trimmed.split(': ');
      if (parts.length === 2) {
        const left = parts[0].trim();
        const right = parts[1].trim();
        const trLeft = dataMap.get(left);
        const trRight = dataMap.get(right) || right;
        if (trLeft) {
          return text.replace(trimmed, `${trLeft}: ${trRight}`);
        }
      }
    }

    // 触发异步在线实时翻译探测
    maybeQueueForOnlineTranslation(trimmed);

    return null;
  }

  // 4. 在线异步实时翻译队列
  const ipc = (function () {
    try { return require('electron').ipcRenderer; } catch (e) {}
    try { return require('electron/renderer').ipcRenderer; } catch (e) {}
    return null;
  })();

  const pendingOnlineQueue = new Set();
  let onlineTimer = null;

  function maybeQueueForOnlineTranslation(str) {
    if (!ipc || !ipc.invoke) return;
    if (str.length < 2 || str.length > 100) return;
    if (!/[a-zA-Z]{2,}/.test(str)) return;
    if (/^https?:|^\/|\.(png|jpg|svg|json|js)$/i.test(str)) return;
    if (dataMap.has(str) || pendingOnlineQueue.has(str)) return;

    pendingOnlineQueue.add(str);

    if (!onlineTimer) {
      onlineTimer = setTimeout(flushOnlineTranslationQueue, 350);
    }
  }

  async function flushOnlineTranslationQueue() {
    onlineTimer = null;
    if (pendingOnlineQueue.size === 0) return;

    const batch = Array.from(pendingOnlineQueue).slice(0, 25);
    batch.forEach(k => pendingOnlineQueue.delete(k));

    try {
      const results = await ipc.invoke('figma-live-translate-batch', batch);
      if (results && typeof results === 'object') {
        let count = 0;
        const localUpdates = {};
        for (const [orig, trans] of Object.entries(results)) {
          if (trans && trans !== orig) {
            dataMap.set(orig, trans);
            localUpdates[orig] = trans;
            count++;
          }
        }
        if (count > 0) {
          try {
            const cur = JSON.parse(localStorage.getItem('figma_cn_dynamic_dict_v2') || '{}');
            Object.assign(cur, localUpdates);
            localStorage.setItem('figma_cn_dynamic_dict_v2', JSON.stringify(cur));
          } catch (e) {}
          // 实时触发页面重新渲染与文本替换
          scheduleWalk();
        }
      }
    } catch (err) {}
  }

  // 5. 遍历与翻译单个节点
  function processNode(node) {
    if (!node) return;
    const type = node.nodeType;

    // 5.1 文本节点
    if (type === 3) {
      const parent = node.parentElement;
      if (!parent || IGNORE_TAGS.has(parent.tagName) || isEditable(parent)) return;
      const val = node.nodeValue;
      if (val && val.trim().length > 0) {
        const trans = translateText(val);
        if (trans && trans !== val) {
          node.nodeValue = trans;
        }
      }
      return;
    }

    // 5.2 元素节点
    if (type === 1) {
      const tag = node.tagName;
      if (IGNORE_TAGS.has(tag) || isEditable(node)) return;

      // 属性翻译
      for (let i = 0; i < ATTRS.length; i++) {
        const attr = ATTRS[i];
        const val = node.getAttribute(attr);
        if (val) {
          const trans = translateText(val);
          if (trans && trans !== val) {
            node.setAttribute(attr, trans);
          }
        }
      }

      // Shadow DOM 穿透
      if (node.shadowRoot) {
        walk(node.shadowRoot);
      }

      // 递归子节点
      let child = node.firstChild;
      while (child) {
        processNode(child);
        child = child.nextSibling;
      }
    }
  }

  function walk(root) {
    if (!root) return;
    processNode(root);
  }

  // 6. 批处理与 rAF 节流 (高频变动合并为单帧处理)
  let scheduled = false;
  function scheduleWalk() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const body = document.body || document.documentElement;
      if (body) walk(body);
    });
  }

  // 7. MutationObserver 监听
  const observer = new MutationObserver(() => {
    scheduleWalk();
  });

  function start() {
    const root = document.documentElement || document.body;
    if (root) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS
      });
      walk(root);

      // 低频 1.0s 周期保底扫描 (针对懒加载弹窗、下拉菜单、Portal 气泡)
      setInterval(() => {
        const body = document.body || document.documentElement;
        if (body) walk(body);
      }, 1000);
    } else {
      setTimeout(start, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 50));
  } else {
    setTimeout(start, 50);
  }
})();

/**
 * Figma 极简 Edge 级实时无感汉化引擎 (Pure Native & Edge-Like)
 * 特性：
 * 1. 深度 DOM & Shadow DOM 穿透，支持 Web Components 与 UI3 动态组件
 * 2. 严格安全沙箱：绝不篡改 SCRIPT/STYLE 标签或可编辑输入框，100% 杜绝 React 运行崩溃
 * 3. 4300+ 词条高保真词典 + 通配符模板 + 属性翻译 (placeholder, title, aria-label 等)
 * 4. 高性能 rAF 批处理防抖 + MutationObserver 实时响应，主线程 60fps 零卡顿
 * 5. 1.0s 低频周期保底补漏，覆盖所有动态气泡菜单与 Portal 弹窗
 */
(function () {
  if (window.__FIGMA_REALTIME_TRANSLATOR_ACTIVE__) return;
  window.__FIGMA_REALTIME_TRANSLATOR_ACTIVE__ = true;

  // 1. 初始化词库
  const dataMap = new Map();
  const patternEntries = [];

  const rawData = (typeof __FIGMA_BUILTIN_TRANSLATIONS__ !== 'undefined' && Array.isArray(__FIGMA_BUILTIN_TRANSLATIONS__))
    ? __FIGMA_BUILTIN_TRANSLATIONS__
    : (typeof __FIGMA_BUILTIN_DICT__ !== 'undefined' && __FIGMA_BUILTIN_DICT__)
      ? Object.entries(__FIGMA_BUILTIN_DICT__)
      : [];

  // 合并本地缓存增量词库
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

  // 判断是否处于可编辑区域（保护用户输入）
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

  // 3. 核心文本翻译
  function translateText(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length < 1) return null;

    // 3.1 精确匹配
    if (dataMap.has(text)) return dataMap.get(text);
    if (dataMap.has(trimmed)) {
      return text.replace(trimmed, dataMap.get(trimmed));
    }

    // 3.2 动态通配符匹配 (如：Zoom to 100%, 12 layers selected)
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

    // 3.3 复合键值对翻译 (如 "Align: Center" 或 "Opacity: 100%")
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

    return null;
  }

  // 4. 遍历与翻译单个节点
  function processNode(node) {
    if (!node) return;
    const type = node.nodeType;

    // 4.1 文本节点 (Node.TEXT_NODE === 3)
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

    // 4.2 元素节点 (Node.ELEMENT_NODE === 1)
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

  // 5. 批处理与 rAF 节流 (高频变动合并为单帧处理)
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

  // 6. MutationObserver 监听
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

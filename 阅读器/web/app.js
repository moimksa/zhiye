(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const article = $('article');
  const scroller = $('readerScroll');
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  let index = {documents: [], groups: []};
  let state = {highlights: [], positions: {}, preferences: {}};
  let current = null;
  let loadSerial = 0;
  let loading = false;
  let selected = null;
  let textMap = {nodes: [], text: ''};
  let anchored = new Map();
  let headings = [];
  let saveTimer, toastTimer, searchTimer;
  let editingNote = null;
  let searchSerial = 0;
  let searchIndex = 0;
  let searchResults = [];
  let tocFrame = null;
  const expanded = new Set(['章节讲义', '专题笔记', '练习与解析']);

  async function api(path, options = {}) {
    const headers = {'X-Reader-Request': '1', ...(options.body ? {'Content-Type': 'application/json'} : {})};
    const response = await fetch(path, {...options, headers: {...headers, ...options.headers}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '暂时无法读取，请稍后重试。');
    return data;
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3300);
  }
  function report(error) {
    console.error(error);
    toast(error.message || '操作未完成，请重试。');
  }
  function button(label, className, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }
  function shortTitle(doc) {
    return doc.title.replace(/^第\s*\d+\s*章\s*/, '');
  }
  function startingDocument() {
    return index.documents.find(d => d.chapter === '01')?.path ||
      index.documents.find(d => !d.path.endsWith('README.md'))?.path || index.documents[0]?.path;
  }
  function renderLibrary() {
    $('documentCount').textContent = `${index.documents.length} 篇`;
    const fragment = document.createDocumentFragment();
    for (const group of index.groups) {
      const docs = index.documents.filter(d => d.group === group);
      if (!docs.length) continue;
      const section = document.createElement('section');
      section.className = 'nav-group';
      const toggle = button('', 'group-toggle', () => {
        expanded.has(group) ? expanded.delete(group) : expanded.add(group);
        renderLibrary();
      });
      toggle.setAttribute('aria-expanded', expanded.has(group));
      toggle.innerHTML = `${icon('chevron')}<span>${escape(group)}</span><span class="group-size">${docs.length}</span>`;
      section.append(toggle);
      const list = document.createElement('div');
      list.hidden = !expanded.has(group);
      for (const doc of docs) {
        const link = button('', 'nav-link' + (doc.path === current?.path ? ' active' : ''), () => loadDoc(doc.path).catch(report));
        link.innerHTML = `${doc.chapter ? `<span class="nav-number">${doc.chapter}</span>` : icon('file')}<span class="nav-title">${escape(shortTitle(doc))}</span>`;
        link.title = doc.title;
        if (doc.path === current?.path) link.setAttribute('aria-current', 'page');
        list.append(link);
      }
      section.append(list);
      fragment.append(section);
    }
    $('library').replaceChildren(fragment);
  }

  function updateChrome() {
    if (!current) return;
    document.title = `${shortTitle(current)} · 知页`;
    $('breadcrumb').innerHTML = `${escape(current.course)}<span>/</span><b>${escape(current.chapter ? `第 ${Number(current.chapter)} 章` : shortTitle(current))}</b>`;
    $('documentEyebrow').innerHTML = current.chapter ? `${escape(current.course)} <span>/</span> CHAPTER ${escape(current.chapter)}` : `${escape(current.course)} <span>/</span> ${escape(current.group)}`;
    $('sectionCount').textContent = `${headings.filter(h => h.tagName === 'H2').length} 个单元`;
    $('saveStatus').textContent = '阅读位置已记录';
    renderLibrary();
  }

  function decorateArticle(raw) {
    const h1 = article.querySelector('h1');
    if (h1) {
      const original = h1.textContent;
      const english = [...original.matchAll(/[（(]([A-Za-z][^）)]*)[）)]/g)].map(m => m[1]);
      h1.textContent = ReaderRenderer.cleanTitle(original);
      let last = h1;
      if (english.length) {
        const subtitle = document.createElement('p');
        subtitle.className = 'title-english';
        subtitle.textContent = english.join(' · ');
        h1.after(subtitle);
        last = subtitle;
      }
      const meta = document.createElement('div');
      meta.className = 'article-meta';
      const date = new Date(current.modified * 1000).toLocaleDateString('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'});
      const length = raw.replace(/```[\s\S]*?```/g, '').replace(/\s/g, '').length;
      meta.innerHTML = `<span>课程笔记</span><span>约 ${(length / 1000).toFixed(1)} 千字</span><span>更新于 ${escape(date)}</span>`;
      last.after(meta);
    }
    article.querySelectorAll('table').forEach(table => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', '表格，可横向滚动');
      table.replaceWith(wrap);
      wrap.append(table);
    });
    const paragraphs = [...article.children].filter(el => el.tagName === 'P' && !el.classList.contains('title-english'));
    if (paragraphs[0]?.querySelector('strong')) paragraphs[0].classList.add('lead-paragraph');
    paragraphs.filter(p => p.textContent.startsWith('来源：')).forEach(p => p.classList.add('source-paragraph'));
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement.closest('.katex,code,pre,.article-meta,.title-english') && /（[A-Za-z][^（）]{1,160}）/.test(node.data)) nodes.push(node);
    }
    for (const node of nodes) {
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const match of node.data.matchAll(/（[A-Za-z][^（）]{1,160}）/g)) {
        fragment.append(document.createTextNode(node.data.slice(last, match.index)));
        const span = document.createElement('span');
        span.className = 'term-en';
        span.textContent = match[0];
        fragment.append(span);
        last = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.data.slice(last)));
      node.replaceWith(fragment);
    }
    headings = [...article.querySelectorAll('h2,h3')];
  }

  function renderTOC() {
    $('toc').replaceChildren();
    if (!headings.length) {
      $('toc').textContent = '这篇笔记适合连贯阅读。';
      return;
    }
    for (const heading of headings) {
      const link = document.createElement('a');
      link.href = '#' + heading.id;
      link.className = heading.tagName === 'H3' ? 'toc-sub' : '';
      link.textContent = ReaderRenderer.cleanTitle(heading.textContent).replace(/[（(][^）)]*页[）)]/g, '').trim();
      link.title = heading.textContent;
      link.addEventListener('click', event => {
        event.preventDefault();
        jumpToHeading(heading.id);
        if (innerWidth < 1191) closeMobilePanels();
      });
      $('toc').append(link);
    }
  }
  function jumpToHeading(id, push = true) {
    let decoded;
    try { decoded = decodeURIComponent(id); } catch { decoded = id; }
    const heading = document.getElementById(decoded);
    if (heading && article.contains(heading)) {
      heading.scrollIntoView({behavior: 'smooth', block: 'start'});
      if (push) history.pushState(null, '', `?doc=${encodeURIComponent(current.path)}#${encodeURIComponent(decoded)}`);
    }
  }
  function renderNavigation() {
    const peers = index.documents.filter(doc => doc.group === current.group);
    const place = peers.findIndex(doc => doc.path === current.path);
    $('readingNavigation').replaceChildren();
    for (const [offset, label, cls] of [[-1, '上一篇', 'previous'], [1, '继续阅读', 'next']]) {
      const doc = peers[place + offset];
      if (!doc) continue;
      const next = button('', cls, () => loadDoc(doc.path).catch(report));
      const content = `<span><small>${label}</small>${escape(shortTitle(doc))}</span>`;
      next.innerHTML = offset === -1 ? icon('arrow') + content : content + icon('arrow');
      $('readingNavigation').append(next);
    }
  }

  async function loadDoc(path, options = {}) {
    if (current?.path === path && !options.force) {
      if (options.hash) jumpToHeading(options.hash, false);
      closeMobilePanels();
      return;
    }
    const serial = ++loadSerial;
    const doc = index.documents.find(item => item.path === path);
    if (!doc) throw new Error('这篇笔记不在书库中。请刷新书库后重试。');
    savePosition();
    loading = true;
    hideSelection();
    let data;
    try {
      data = await api(`/api/document?path=${encodeURIComponent(path)}`);
    } catch (error) {
      if (serial === loadSerial) loading = false;
      throw error;
    }
    if (serial !== loadSerial) return;
    current = {...doc, modified: data.modified};
    const result = ReaderRenderer.render(data.content, path);
    article.innerHTML = DOMPurify.sanitize(result.html);
    article.dataset.document = path;
    article.dataset.mathErrors = result.errors.length;
    decorateArticle(data.content);
    renderTOC();
    renderNavigation();
    $('documentEnd').hidden = false;
    expanded.add(current.group);
    updateChrome();
    rebuildTextMap();
    paintHighlights();
    renderHighlights();
    closeMobilePanels();
    if (!options.noHistory) history.pushState(null, '', `?doc=${encodeURIComponent(path)}`);
    state.lastDocument = path;
    api('/api/state', {method: 'PATCH', body: JSON.stringify({lastDocument: path})}).catch(report);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    if (serial !== loadSerial) return;
    const fraction = options.fraction ?? state.positions[path] ?? 0;
    scroller.scrollTo({top: fraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight), behavior: 'instant'});
    loading = false;
    if (options.hash) jumpToHeading(options.hash, false);
    updateProgress();
    if (result.errors.length) toast(`${result.errors.length} 处公式暂未渲染，已保留原式。`);
  }

  function updateProgress() {
    if (!current || loading) return;
    const available = scroller.scrollHeight - scroller.clientHeight;
    const fraction = available > 1 ? scroller.scrollTop / available : 0;
    const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
    $('readingProgress').style.width = `${percent}%`;
    $('progressLabel').textContent = `阅读位置 ${percent}%`;
    state.positions[current.path] = fraction;
    const edge = scroller.getBoundingClientRect().top + 100;
    let active = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= edge) active = heading;
      else break;
    }
    [...$('toc').children].forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + active?.id));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 850);
  }
  function savePosition(keepalive = false) {
    clearTimeout(saveTimer);
    if (!current || loading) return;
    const documentPath = current.path;
    const value = state.positions[documentPath] || 0;
    api('/api/state', {method: 'PATCH', keepalive, body: JSON.stringify({position: {document: documentPath, value}})})
      .then(() => { $('saveStatus').textContent = '阅读位置已记录'; })
      .catch(() => { $('saveStatus').textContent = '阅读位置暂未保存'; });
  }

  function rebuildTextMap(clean = true) {
    if (clean) {
      article.querySelectorAll('mark.reading-highlight').forEach(mark => mark.replaceWith(...mark.childNodes));
      article.normalize();
    }
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {acceptNode(node) {
      return node.parentElement.closest('.katex-mathml,.article-meta,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }});
    const nodes = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({node, start: text.length, end: text.length + node.data.length});
      text += node.data;
    }
    textMap = {nodes, text};
  }
  function offsetAt(node, offset) {
    const entry = textMap.nodes.find(item => item.node === node);
    if (entry) return entry.start + offset;
    const prefix = document.createRange();
    prefix.selectNodeContents(article);
    prefix.setEnd(node, offset);
    let total = 0;
    for (const item of textMap.nodes) {
      if (prefix.comparePoint(item.node, item.node.data.length) === 0) total = item.end;
    }
    return total;
  }
  function rangeAt(start, end) {
    const first = textMap.nodes.find(n => n.end > start && n.start <= start);
    const last = textMap.nodes.find(n => n.end >= end && n.start < end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }
  function captureSelection() {
    if (loading || !current || $('searchDialog').open || $('noteDialog').open) return;
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return hideSelection();
    const range = selection.getRangeAt(0);
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return hideSelection();
    // The fallback painter splits text nodes, so use the current DOM for offsets.
    rebuildTextMap(false);
    let start = offsetAt(range.startContainer, range.startOffset);
    let end = offsetAt(range.endContainer, range.endOffset);
    const value = textMap.text.slice(start, end);
    const leading = value.length - value.trimStart().length;
    const trailing = value.length - value.trimEnd().length;
    start += leading;
    end -= trailing;
    if (end <= start || end - start > 20000) return hideSelection();
    const rect = range.getBoundingClientRect();
    selected = {document: current.path, quote: textMap.text.slice(start, end), start, end,
      prefix: textMap.text.slice(Math.max(0, start - 48), start), suffix: textMap.text.slice(end, end + 48)};
    $('selectionToolbar').hidden = false;
    const width = $('selectionToolbar').offsetWidth;
    const center = Math.max(width / 2 + 10, Math.min(innerWidth - width / 2 - 10, rect.left + rect.width / 2));
    $('selectionToolbar').style.left = center + 'px';
    $('selectionToolbar').style.top = (rect.top > 110 ? rect.top - 51 : rect.bottom + 10) + 'px';
  }
  function hideSelection() {
    $('selectionToolbar').hidden = true;
    selected = null;
  }
  function paintHighlights() {
    anchored = new Map();
    const colors = {yellow: [], green: [], purple: []};
    for (const item of state.highlights.filter(h => h.document === current?.path)) {
      const location = ReaderAnchors.locate(textMap.text, item);
      if (!location) continue;
      const range = rangeAt(location.start, location.end);
      if (range) {
        anchored.set(item.id, {range, ...location});
        colors[item.color].push(range);
      }
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      for (const [color, ranges] of Object.entries(colors)) CSS.highlights.set('reader-' + color, new Highlight(...ranges));
    } else {
      // Keep formulas intact in older browsers; mark only ordinary text nodes.
      const pieces = [];
      for (const entry of textMap.nodes) {
        if (entry.node.parentElement.closest('.katex')) continue;
        const hits = state.highlights.filter(h => h.document === current?.path && anchored.has(h.id)).map(h => ({...h, ...anchored.get(h.id)})).filter(h => h.start < entry.end && h.end > entry.start);
        if (hits.length) pieces.push({entry, hits});
      }
      for (const {entry, hits} of pieces) {
        const boundaries = [...new Set([0, entry.node.length, ...hits.flatMap(h => [Math.max(0, h.start - entry.start), Math.min(entry.node.length, h.end - entry.start)])])].sort((a, b) => a - b);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < boundaries.length - 1; i++) {
          const a = boundaries[i], b = boundaries[i + 1];
          const hit = hits.filter(h => h.start <= entry.start + a && h.end >= entry.start + b).at(-1);
          const text = entry.node.data.slice(a, b);
          if (hit) {
            const mark = document.createElement('mark');
            mark.className = 'reading-highlight';
            mark.dataset.color = hit.color;
            mark.textContent = text;
            fragment.append(mark);
          } else fragment.append(document.createTextNode(text));
        }
        entry.node.replaceWith(fragment);
      }
      rebuildTextMap(false);
      for (const location of anchored.values()) location.range = rangeAt(location.start, location.end);
    }
  }
  async function addHighlight(color) {
    if (!selected) return;
    const payload = {...selected, color};
    try {
      const item = await api('/api/highlights', {method: 'POST', body: JSON.stringify(payload)});
      const previous = state.highlights.findIndex(h => h.id === item.id);
      if (previous < 0) state.highlights.push(item); else state.highlights[previous] = item;
      window.getSelection().removeAllRanges();
      hideSelection();
      rebuildTextMap();
      paintHighlights();
      renderHighlights();
      toast('高光已保存');
    } catch (error) { report(error); }
  }
  function renderHighlights() {
    const page = state.highlights.filter(h => h.document === current?.path);
    $('pageHighlightCount').textContent = page.length;
    $('allHighlightCount').textContent = state.highlights.length;
    const items = ($('highlightScope').value === 'all' ? state.highlights : page).slice().sort((a, b) => b.created - a.created);
    $('highlightList').replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `${icon('highlight')}<p>重要的句子，值得再看一遍。<br>选中文字后选择颜色，<br>你的高光会保存在这里。</p>`;
      $('highlightList').append(empty);
    }
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'highlight-card';
      card.dataset.color = item.color;
      const doc = index.documents.find(d => d.path === item.document);
      const source = document.createElement('div');
      source.className = 'highlight-source';
      source.textContent = doc ? shortTitle(doc) : '原文暂不可用';
      const quote = button(item.quote, 'highlight-quote', () => jumpToHighlight(item).catch(report));
      quote.title = '跳到原文';
      card.append(source, quote);
      if (item.note) {
        const note = document.createElement('p');
        note.className = 'highlight-note';
        note.textContent = item.note;
        card.append(note);
      }
      if (item.document === current?.path && !anchored.has(item.id)) {
        const missing = document.createElement('p');
        missing.className = 'highlight-missing';
        missing.textContent = '原文已变化，选文和笔记仍保留。';
        card.append(missing);
      }
      const actions = document.createElement('div');
      actions.className = 'highlight-actions';
      const date = document.createElement('time');
      date.dateTime = new Date(item.created * 1000).toISOString();
      date.textContent = new Date(item.created * 1000).toLocaleDateString('zh-CN', {month: '2-digit', day: '2-digit'});
      const controls = document.createElement('div');
      const edit = button('', 'icon-button', () => openNote(item));
      edit.innerHTML = icon('note');
      edit.setAttribute('aria-label', '编辑高光笔记');
      edit.title = '编辑笔记';
      const remove = button('', 'icon-button', async () => {
        remove.disabled = true;
        try {
          await api(`/api/highlights/${item.id}`, {method: 'DELETE'});
          state.highlights = state.highlights.filter(h => h.id !== item.id);
          rebuildTextMap();
          paintHighlights();
          renderHighlights();
          toast('已移除这条高光');
        } catch (error) { remove.disabled = false; report(error); }
      });
      remove.innerHTML = icon('trash');
      remove.setAttribute('aria-label', '删除这条高光');
      remove.title = '删除高光';
      controls.append(edit, remove);
      actions.append(date, controls);
      card.append(actions);
      $('highlightList').append(card);
    }
  }
  async function jumpToHighlight(item) {
    await loadDoc(item.document);
    const found = anchored.get(item.id);
    if (!found) return toast('原文已变化，无法准确定位；选文仍保留在高光中。');
    const rect = found.range.getBoundingClientRect();
    scroller.scrollTo({top: scroller.scrollTop + rect.top - scroller.getBoundingClientRect().top - 100, behavior: 'smooth'});
    const parent = found.range.startContainer.parentElement.closest('p,li,td,h2,h3') || found.range.startContainer.parentElement;
    parent.classList.add('jump-flash');
    setTimeout(() => parent.classList.remove('jump-flash'), 1500);
    closeMobilePanels();
  }
  function openNote(item) {
    editingNote = item.id;
    $('noteQuote').textContent = item.quote;
    $('noteInput').value = item.note || '';
    $('noteDialog').showModal();
    $('noteInput').focus();
  }

  function showContext(tab = 'toc', scope) {
    document.body.classList.remove('context-collapsed');
    if (innerWidth < 1191) document.body.classList.add('context-open');
    if (innerWidth <= 800) $('mobileBackdrop').hidden = false;
    const highlights = tab === 'highlights';
    $('tocTab').setAttribute('aria-selected', !highlights);
    $('highlightTab').setAttribute('aria-selected', highlights);
    $('tocPane').hidden = highlights;
    $('highlightsPane').hidden = !highlights;
    $('contextButton').setAttribute('aria-expanded', 'true');
    if (scope) $('highlightScope').value = scope;
    if (highlights) renderHighlights();
  }
  function closeMobilePanels() {
    document.body.classList.remove('sidebar-open', 'context-open');
    $('mobileBackdrop').hidden = true;
  }
  function applyPreferences() {
    const prefs = state.preferences;
    document.documentElement.dataset.theme = prefs.theme === 'dark' ? 'dark' : 'light';
    const size = Math.max(14, Math.min(23, Number(prefs.fontSize) || 17));
    document.documentElement.style.setProperty('--font-size', size + 'px');
    document.body.classList.toggle('wide-reading', Boolean(prefs.wide));
    document.body.classList.toggle('focus-mode', Boolean(prefs.focus));
    $('focusButton').setAttribute('aria-pressed', Boolean(prefs.focus));
    $('focusButton').title = prefs.focus ? '退出专注 · F' : '专注阅读 · F';
    $('fontSizeLabel').textContent = size;
    $('fontSmaller').disabled = size <= 14;
    $('fontLarger').disabled = size >= 23;
    $('wideToggle').checked = Boolean(prefs.wide);
    document.querySelectorAll('[data-theme-choice]').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === document.documentElement.dataset.theme));
  }
  function setPreference(key, value) {
    const fraction = current ? state.positions[current.path] || 0 : 0;
    state.preferences[key] = value;
    applyPreferences();
    requestAnimationFrame(() => scroller.scrollTo({top: fraction * (scroller.scrollHeight - scroller.clientHeight), behavior: 'instant'}));
    api('/api/state', {method: 'PATCH', body: JSON.stringify({preferences: {[key]: value}})}).catch(report);
  }

  function openSearch() {
    hideSelection();
    $('searchDialog').showModal();
    $('searchInput').value = '';
    searchResults = index.documents.filter(d => d.group === '章节讲义');
    $('searchSummary').textContent = '课程章节 · 输入文字搜索全文';
    renderSearch('');
    $('searchInput').focus();
  }
  function matchMarkup(text, query) {
    if (!query) return escape(text);
    const offset = text.toLowerCase().indexOf(query.toLowerCase());
    return offset < 0 ? escape(text) : escape(text.slice(0, offset)) + '<mark>' + escape(text.slice(offset, offset + query.length)) + '</mark>' + escape(text.slice(offset + query.length));
  }
  function renderSearch(query) {
    $('searchResults').replaceChildren();
    searchIndex = 0;
    searchResults.forEach((doc, i) => {
      const result = button('', 'search-result' + (!i ? ' selected' : ''), () => {
        $('searchDialog').close();
        loadDoc(doc.path).catch(report);
      });
      const snippet = (doc.snippet || `${doc.group} · ${doc.course}`).replace(/[#*`]/g, '');
      result.innerHTML = `${icon('file')}<span><strong>${matchMarkup(doc.title, query)}</strong><small>${matchMarkup(snippet, query)}</small></span>`;
      $('searchResults').append(result);
    });
    if (!searchResults.length) {
      const empty = document.createElement('p');
      empty.className = 'loading-copy';
      empty.textContent = '没有找到相关内容，试试中文概念或英文术语。';
      $('searchResults').append(empty);
    }
  }
  async function search() {
    const serial = ++searchSerial;
    const query = $('searchInput').value.trim();
    if (!query) {
      searchResults = index.documents.filter(d => d.group === '章节讲义');
      $('searchSummary').textContent = '课程章节 · 输入文字搜索全文';
      return renderSearch('');
    }
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(query));
      if (serial !== searchSerial || query !== $('searchInput').value.trim()) return;
      searchResults = data.results;
      $('searchSummary').textContent = `${data.results.length} 篇相关笔记`;
      renderSearch(query);
    } catch (error) { report(error); }
  }

  async function refreshLibrary(manual = false) {
    if (document.hidden && !manual) return;
    try {
      const next = await api('/api/index');
      if (next.fingerprint !== index.fingerprint) {
        index = next;
        renderLibrary();
      }
      const changed = index.documents.find(d => d.path === current?.path);
      if (!loading && changed && changed.modified !== current.modified && !window.getSelection()?.toString() && !$('noteDialog').open) {
        await loadDoc(changed.path, {force: true, noHistory: true, fraction: state.positions[changed.path] || 0});
        toast('笔记已更新，阅读位置已保留');
      }
      $('syncStatus').textContent = '本地知识库';
      if (manual) toast(`书库已更新 · ${index.documents.length} 篇笔记`);
    } catch (error) {
      $('syncStatus').textContent = '连接暂时中断';
      if (manual) report(error);
    }
  }

  $('brandButton').addEventListener('click', () => loadDoc(startingDocument()).catch(report));
  $('searchButton').addEventListener('click', openSearch);
  $('closeSearch').addEventListener('click', () => $('searchDialog').close());
  $('searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 180); });
  $('searchInput').addEventListener('keydown', event => {
    const buttons = [...$('searchResults').querySelectorAll('button')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      searchIndex = Math.max(0, Math.min(buttons.length - 1, searchIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      buttons.forEach((b, i) => b.classList.toggle('selected', i === searchIndex));
      buttons[searchIndex]?.scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter') {
      event.preventDefault();
      buttons[searchIndex]?.click();
    }
  });
  $('refreshButton').addEventListener('click', () => refreshLibrary(true));
  $('focusButton').addEventListener('click', () => setPreference('focus', !state.preferences.focus));
  $('sidebarButton').addEventListener('click', () => {
    if (state.preferences.focus) setPreference('focus', false);
    if (innerWidth <= 800) {
      document.body.classList.toggle('sidebar-open');
      $('mobileBackdrop').hidden = !document.body.classList.contains('sidebar-open');
    } else document.body.classList.toggle('sidebar-collapsed');
    $('sidebarButton').setAttribute('aria-expanded', !document.body.classList.contains('sidebar-collapsed'));
  });
  $('contextButton').addEventListener('click', () => {
    if (state.preferences.focus) setPreference('focus', false);
    if (innerWidth < 1191) {
      if (document.body.classList.contains('context-open')) closeMobilePanels();
      else showContext($('tocPane').hidden ? 'highlights' : 'toc');
    } else {
      document.body.classList.toggle('context-collapsed');
      $('contextButton').setAttribute('aria-expanded', !document.body.classList.contains('context-collapsed'));
    }
  });
  $('mobileBackdrop').addEventListener('click', closeMobilePanels);
  $('tocTab').addEventListener('click', () => showContext('toc'));
  $('highlightTab').addEventListener('click', () => showContext('highlights', 'page'));
  $('allHighlightsButton').addEventListener('click', () => { if (state.preferences.focus) setPreference('focus', false); closeMobilePanels(); showContext('highlights', 'all'); });
  $('highlightScope').addEventListener('change', renderHighlights);
  $('appearanceButton').addEventListener('click', () => {
    $('appearancePopover').hidden = !$('appearancePopover').hidden;
    $('appearanceButton').setAttribute('aria-expanded', !$('appearancePopover').hidden);
  });
  $('fontSmaller').addEventListener('click', () => setPreference('fontSize', Math.max(14, (Number(state.preferences.fontSize) || 17) - 1)));
  $('fontLarger').addEventListener('click', () => setPreference('fontSize', Math.min(23, (Number(state.preferences.fontSize) || 17) + 1)));
  $('wideToggle').addEventListener('change', event => setPreference('wide', event.target.checked));
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setPreference('theme', button.dataset.themeChoice)));
  document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => addHighlight(button.dataset.color)));
  $('selectionToolbar').addEventListener('pointerdown', event => event.preventDefault());
  $('copySelectionButton').addEventListener('click', async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.quote); toast('选文已复制'); hideSelection(); } catch { toast('复制未完成，请使用系统复制快捷键。'); }
  });
  article.addEventListener('pointerup', () => setTimeout(captureSelection, 30));
  article.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    if (href?.startsWith('?doc=')) {
      event.preventDefault();
      const url = new URL(href, location.href);
      loadDoc(url.searchParams.get('doc'), {hash: url.hash.slice(1)}).catch(report);
    } else if (href?.startsWith('#')) {
      event.preventDefault();
      jumpToHeading(href.slice(1));
    }
  });
  scroller.addEventListener('scroll', () => {
    hideSelection();
    if (!tocFrame) tocFrame = requestAnimationFrame(() => { updateProgress(); tocFrame = null; });
  }, {passive: true});
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#appearancePopover,#appearanceButton')) {
      $('appearancePopover').hidden = true;
      $('appearanceButton').setAttribute('aria-expanded', 'false');
    }
    if (!event.target.closest('#article,#selectionToolbar')) hideSelection();
  });
  document.addEventListener('keyup', event => { if (event.key === 'Shift') captureSelection(); });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    else if (event.key === 'Escape') { hideSelection(); closeMobilePanels(); $('appearancePopover').hidden = true; }
    else if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable=true]') && !$('searchDialog').open && !$('noteDialog').open) {
      event.preventDefault();
      setPreference('focus', !state.preferences.focus);
    }
  });
  $('noteForm').addEventListener('submit', async event => {
    event.preventDefault();
    const save = event.submitter;
    save.disabled = true;
    try {
      const item = await api('/api/highlights/' + editingNote, {method: 'PATCH', body: JSON.stringify({note: $('noteInput').value})});
      state.highlights = state.highlights.map(h => h.id === item.id ? item : h);
      renderHighlights();
      $('noteDialog').close();
      toast('高光笔记已保存');
    } catch (error) { report(error); } finally { save.disabled = false; }
  });
  for (const id of ['closeNote', 'cancelNote']) $(id).addEventListener('click', () => $('noteDialog').close());
  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    loadDoc(url.searchParams.get('doc') || state.lastDocument, {noHistory: true, hash: url.hash.slice(1)}).catch(report);
  });
  window.addEventListener('beforeunload', () => savePosition(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(true); else refreshLibrary(); });

  async function boot() {
    try {
      [index, state] = await Promise.all([api('/api/index'), api('/api/state')]);
      applyPreferences();
      const url = new URL(location.href);
      const requested = url.searchParams.get('doc') || state.lastDocument;
      const path = index.documents.some(d => d.path === requested) ? requested : startingDocument();
      if (!path) throw new Error('暂时没有找到 Markdown 笔记。将笔记放入本项目后刷新书库即可。');
      history.replaceState(null, '', `?doc=${encodeURIComponent(path)}${url.hash}`);
      await loadDoc(path, {noHistory: true, hash: url.hash.slice(1)});
      setInterval(refreshLibrary, 12000);
    } catch (error) {
      loading = false;
      article.innerHTML = `<div class="error-state"><h2>书库暂时没有打开</h2><p>${escape(error.message)}</p><button id="retryLoad">重新连接</button></div>`;
      $('retryLoad').addEventListener('click', boot);
    }
  }
  boot();
})();

/* Shared by the browser and the rendering checks. */
(() => {
  'use strict';
  const md = globalThis.markdownit({html: false, linkify: true, breaks: false, typographer: false});
  const escape = md.utils.escapeHtml;
  let errors = [];

  function mathHTML(tex, display) {
    try {
      return globalThis.katex.renderToString(tex, {displayMode: display, throwOnError: true, trust: false, strict: 'ignore', output: 'htmlAndMathml', maxExpand: 1000});
    } catch (error) {
      errors.push({tex, message: error.message});
      return `<code class="math-error" title="公式暂未渲染">${escape(tex)}</code>`;
    }
  }

  md.inline.ruler.before('escape', 'study_inline_math', (state, silent) => {
    if (!state.src.startsWith('\\(', state.pos)) return false;
    const end = state.src.indexOf('\\)', state.pos + 2);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('study_math', 'span', 0);
      token.content = state.src.slice(state.pos + 2, end);
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.study_math = (tokens, index) => `<span class="math-inline">${mathHTML(tokens[index].content, false)}</span>`;

  md.block.ruler.before('fence', 'study_display_math', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
    const opener = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
    if (!opener) return false;
    const closer = opener === '$$' ? '$$' : '\\]';
    let line = start;
    let text = first.slice(2);
    let stop = text.indexOf(closer);
    if (stop >= 0 && text.slice(stop + 2).trim()) return false;
    if (stop < 0) {
      while (++line < end) {
        const next = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        const at = next.indexOf(closer);
        if (at >= 0 && !next.slice(at + 2).trim()) {
          text += '\n' + next.slice(0, at);
          stop = text.length;
          break;
        }
        text += '\n' + next;
      }
      if (stop < 0) return false;
    } else {
      text = text.slice(0, stop);
    }
    if (silent) return true;
    const token = state.push('study_math_block', 'div', 0);
    token.block = true;
    token.content = text.trim();
    token.map = [start, line + 1];
    state.line = line + 1;
    return true;
  }, {alt: ['paragraph', 'reference', 'blockquote', 'list']});
  md.renderer.rules.study_math_block = (tokens, index) => `<div class="math-block">${mathHTML(tokens[index].content, true)}</div>\n`;

  function resolveLink(href, current) {
    if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return href;
    const [file, fragment = ''] = href.split('#');
    let decoded;
    try { decoded = decodeURIComponent(file); } catch { decoded = file; }
    const parts = current.split('/').slice(0, -1);
    for (const part of decoded.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    const path = parts.join('/');
    const suffix = fragment ? '#' + fragment : '';
    return /\.md$/i.test(path) ? `?doc=${encodeURIComponent(path)}${suffix}` : `/file?path=${encodeURIComponent(path)}${suffix}`;
  }
  const defaultLink = md.renderer.rules.link_open || ((tokens, i, options, env, renderer) => renderer.renderToken(tokens, i, options));
  md.renderer.rules.link_open = (tokens, i, options, env, renderer) => {
    const token = tokens[i];
    const target = resolveLink(token.attrGet('href'), env.path);
    token.attrSet('href', target);
    if (!target.startsWith('?doc=') && !target.startsWith('#')) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLink(tokens, i, options, env, renderer);
  };
  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, i, options, env, renderer) => {
    tokens[i].attrSet('src', resolveLink(tokens[i].attrGet('src'), env.path));
    tokens[i].attrSet('loading', 'lazy');
    return defaultImage(tokens, i, options, env, renderer);
  };

  function slug(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/ /g, '-');
  }
  md.core.ruler.push('study_heading_ids', (state) => {
    const seen = new Map();
    state.tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return;
      const next = state.tokens[index + 1];
      const text = (next.children || []).map(child => child.type === 'text' || child.type === 'code_inline' || child.type === 'study_math' ? child.content : '').join('');
      const base = slug(text);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      token.attrSet('id', base + (count ? '-' + count : ''));
    });
  });

  globalThis.ReaderRenderer = {
    render(raw, path) {
      errors = [];
      const html = md.render(raw, {path});
      return {html, errors: [...errors]};
    },
    slug,
    resolveLink,
    cleanTitle: text => text.replace(/[（(][A-Za-z][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim()
  };
})();

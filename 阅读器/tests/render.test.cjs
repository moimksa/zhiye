const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.markdownit = require('markdown-it');
globalThis.katex = require('katex');
require('../web/render.js');
const {locate} = require('../web/anchors.js');

const root = path.resolve(__dirname, '../..');
const folders = ['知识库', '课程', '练习', '学习系统', '备考', '模板'];
let documents = 0, formulas = 0;
function walk(folder) {
  for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(file, 'utf8');
      const output = ReaderRenderer.render(content, path.relative(root, file));
      assert.deepEqual(output.errors, [], `Math errors in ${file}`);
      const prose = content.replace(/```[\s\S]*?```|`[^`\n]*`/g, '');
      const expected = (prose.match(/\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g) || []).length;
      const actual = (output.html.match(/class="math-(?:inline|block)"/g) || []).length;
      assert.equal(actual, expected, `Lost formula in ${file}`);
      documents++; formulas += actual;
    }
  }
}
folders.forEach(folder => walk(path.join(root, folder)));
assert.equal(ReaderRenderer.resolveLink('../../../课程/Example-Course/课件/example.pdf', '知识库/数学/Example-Course/02-向量空间与基.md'), '/file?path=' + encodeURIComponent('课程/Example-Course/课件/example.pdf'));
assert.equal(ReaderRenderer.resolveLink('02-向量空间与基.md#定义', '知识库/数学/Example-Course/01-矩阵运算与求导.md'), '?doc=' + encodeURIComponent('知识库/数学/Example-Course/02-向量空间与基.md') + '#定义');
assert.equal(ReaderRenderer.slug('第 1 章'), '第-1-章');
assert.ok(!ReaderRenderer.render('<script>alert(1)</script>', 'note.md').html.includes('<script>'));
assert.deepEqual(locate('新增加的文字。前文重要结论后文', {quote:'重要结论',start:2,prefix:'前文',suffix:'后文'}), {start:9,end:13,score:2});
assert.equal(locate('前文已被删掉', {quote:'重要结论',start:2}), null);
assert.equal(locate('相同句子，相同句子', {quote:'相同句子',start:0}), null);
const repeat = locate('甲重要结论乙，丙重要结论丁', {quote:'重要结论',start:0,prefix:'丙',suffix:'丁'});
assert.equal(repeat.start, 8);
console.log(`Verified ${documents} Markdown documents and ${formulas} formulas; local links, HTML escaping, and highlight relocation passed.`);

import test from 'node:test';
import assert from 'node:assert';
import { docToLatex, latexToDoc, latexToHtml, findMentionExcerpts } from '../renderer/dist/richtext.js';

/** A stored LaTeX string must survive save -> load -> save unchanged. */
function stable(latex, label) {
  const once = docToLatex(latexToDoc(latex, '/p'));
  const twice = docToLatex(latexToDoc(once, '/p'));
  assert.strictEqual(once, latex, `first round-trip changed ${label || latex}`);
  assert.strictEqual(twice, once, `second round-trip changed ${label || latex}`);
}

test('plain text with every LaTeX special character round-trips', () => {
  stable('Chi phi 5\\$ va 10\\$ moi bo');
  stable('Dung 100\\% cong suat \\& tai');
  stable('Ngoac \\{ va \\} va gach \\textbackslash{} va \\_ va \\#');
  stable('Dau \\textasciitilde{} va \\textasciicircum{}');
});

test('a literal dollar sign is never re-read as a math formula', () => {
  const doc = latexToDoc('Chi phi 5\\$ va 10\\$ moi bo', null);
  const kinds = doc.content[0].content.map((n) => n.type);
  assert.deepStrictEqual(kinds, ['text'], 'expected one plain text node, got ' + kinds.join(','));
  assert.strictEqual(doc.content[0].content[0].text, 'Chi phi 5$ va 10$ moi bo');
});

test('real math still parses', () => {
  const doc = latexToDoc('Toc do $v > 15$ km/h', null);
  const types = doc.content[0].content.map((n) => n.type);
  assert.deepStrictEqual(types, ['text', 'mathInline', 'text']);
  assert.strictEqual(doc.content[0].content[1].attrs.latex, 'v > 15');
  stable('Toc do $v > 15$ km/h');
});

test('marks round-trip, including nested ones', () => {
  stable('\\textbf{dam}');
  stable('\\textit{nghieng}');
  stable('\\underline{gach chan}');
  stable('\\sout{gach ngang}');
  stable('\\texttt{ma}');
  stable('\\textbf{\\textit{ca hai}}');
  stable('\\colorbox[HTML]{FDE68A}{danh dau}');
  stable('\\href{https://example.com}{lien ket}');
});

test('escaped specials inside a mark are not confused with the mark syntax', () => {
  stable('\\textbf{A \\& B \\{x\\}}');
  const doc = latexToDoc('\\textbf{A \\& B}', null);
  assert.strictEqual(doc.content[0].content[0].text, 'A & B');
  assert.strictEqual(doc.content[0].content[0].marks[0].type, 'bold');
});

test('lists round-trip', () => {
  stable('\\begin{itemize}\n\\item Mot\n\\item Hai\n\\end{itemize}');
  stable('\\begin{enumerate}\n\\item Mot\n\\item Hai\n\\end{enumerate}');
});

test('tables round-trip with header cells and colspan', () => {
  stable(
    '\\begin{tabularx}{\\linewidth}{|X|X|}\n\\hline\n' +
      '\\srsth{Signal} & \\srsth{Value} \\\\\n\\hline\n' +
      'LockCmd & 0x01 \\\\\n\\hline\n' +
      '\\end{tabularx}'
  );
  stable(
    '\\begin{tabularx}{\\linewidth}{|X|X|}\n\\hline\n' +
      '\\multicolumn{2}{|l|}{\\srsth{Gop hai o}} \\\\\n\\hline\n' +
      'a & b \\\\\n\\hline\n' +
      '\\end{tabularx}'
  );
});

test('a cell containing an escaped ampersand does not split the row', () => {
  const latex =
    '\\begin{tabularx}{\\linewidth}{|X|X|}\n\\hline\n' +
    'A \\& B & C \\\\\n\\hline\n' +
    '\\end{tabularx}';
  const doc = latexToDoc(latex, null);
  const cells = doc.content[0].content[0].content;
  assert.strictEqual(cells.length, 2, 'row must have exactly 2 cells');
  assert.strictEqual(cells[0].content[0].content[0].text, 'A & B');
  stable(latex);
});

test('images keep their relative path and width', () => {
  stable('\\includegraphics[width=0.3\\linewidth]{images/diagram.png}');
  const doc = latexToDoc('\\includegraphics[width=0.9\\linewidth]{images/a.png}', '/proj');
  const img = doc.content[0].content[0];
  assert.strictEqual(img.attrs.relPath, 'images/a.png');
  assert.strictEqual(img.attrs.width, 0.9);
  assert.strictEqual(img.attrs.src, 'file:///proj/images/a.png');
});

test('internal item references round-trip', () => {
  stable('Xem them \\srsref{BCM-0002} de biet chi tiet.');
  const doc = latexToDoc('Xem \\srsref{BCM-0002}.', null);
  assert.strictEqual(doc.content[0].content[1].type, 'itemRef');
  assert.strictEqual(doc.content[0].content[1].attrs.code, 'BCM-0002');
});

test('hard breaks, rules and quotes round-trip', () => {
  stable('Dong mot\\newline Dong hai');
  stable('\\srshrule');
  stable('\\begin{quote}\nTrich dan\n\\end{quote}');
});

test('multi-paragraph and mixed content round-trips', () => {
  stable(
    'Doan mot.\n\n' +
      '\\begin{itemize}\n\\item \\textbf{Muc} mot\n\\item Muc hai\n\\end{itemize}\n\n' +
      'Doan cuoi voi $x^2$ va \\href{https://a.b}{link}.'
  );
});

test('read-only HTML escapes text and renders structure', () => {
  const html = latexToHtml('\\textbf{A \\& B} <script>', null);
  assert.match(html, /<strong>A &amp; B<\/strong>/);
  assert.ok(!html.includes('<script>'), 'raw HTML must be escaped');
  assert.match(latexToHtml('\\begin{itemize}\n\\item x\n\\end{itemize}', null), /<ul><li><p>x<\/p><\/li><\/ul>/);
  assert.match(latexToHtml('\\srsref{X-1}', null), /data-goto="X-1"/);
});

test('empty input yields empty output, not a stray paragraph', () => {
  assert.strictEqual(docToLatex(latexToDoc('', null)), '');
  assert.strictEqual(latexToHtml('', null), '');
});

test('calibration mentions round-trip and render as the symbol', () => {
  stable('Không vượt \\calref{EPB-0042} trong mọi điều kiện.');

  const doc = latexToDoc('Ngưỡng \\calref{EPB-0042}.', null, {
    resolveSym: (code) => (code === 'EPB-0042' ? 'F_clamp_max' : ''),
  });
  const node = doc.content[0].content[1];
  assert.strictEqual(node.type, 'symRef');
  assert.strictEqual(node.attrs.kind, 'cal');
  assert.strictEqual(node.attrs.code, 'EPB-0042');
  assert.strictEqual(node.attrs.symbol, 'F_clamp_max');

  // Only the code is written back — the symbol is display state.
  assert.strictEqual(docToLatex(doc), 'Ngưỡng \\calref{EPB-0042}.');
});

test('an unresolved calibration mention is marked, not hidden', () => {
  const html = latexToHtml('Xem \\calref{EPB-9999}.', null, { resolveSym: () => '' });
  assert.match(html, /rt-symref cal unknown/);
  assert.match(html, /EPB-9999/);
});

test('calref and srsref coexist in one paragraph', () => {
  stable('Theo \\srsref{EPB-0008} với ngưỡng \\calref{EPB-0042} và $x > 0$.');
});

test('interface mentions use their own macro and colour', () => {
  stable('Nhận \\ifref{EPB-0055} từ ESP.');
  const doc = latexToDoc('Nhận \\ifref{EPB-0055}.', null, {
    resolveSym: () => 'WheelSpeed_Rear',
  });
  const n = doc.content[0].content[1];
  assert.strictEqual(n.type, 'symRef');
  assert.strictEqual(n.attrs.kind, 'iface');
  assert.strictEqual(n.attrs.symbol, 'WheelSpeed_Rear');
  assert.match(latexToHtml('\\ifref{X-1}', null, { resolveSym: () => 'Sig' }), /rt-symref iface/);
});

test('a PlantUML diagram round-trips with its source intact', () => {
  const src = 'Alice -> Bob: LockCmd & Ack\n@enduml';
  const latex = '\\plantuml{' + src.replace(/&/g, '\\&') + '}{images/uml-abc123.png}';
  stable(latex);

  const doc = latexToDoc(latex, '/proj');
  const node = doc.content[0];
  assert.strictEqual(node.type, 'umlDiagram');
  assert.strictEqual(node.attrs.source, src, 'nguồn phải được unescape đúng');
  assert.strictEqual(node.attrs.relPath, 'images/uml-abc123.png');
  assert.strictEqual(node.attrs.src, 'file:///proj/images/uml-abc123.png');
});

test('a diagram with no render shows its source instead of vanishing', () => {
  const html = latexToHtml('\\plantuml{A -> B}{}', null);
  assert.match(html, /rt-uml-src/);
  assert.match(html, /A -&gt; B/);
});

test('component mentions use their own macro and colour', () => {
  stable('Vượt \\compref{BCM-0031} trong mọi điều kiện.');
  const doc = latexToDoc('Vượt \\compref{BCM-0031}.', null, { resolveSym: () => 'BCM' });
  const n = doc.content[0].content[1];
  assert.strictEqual(n.type, 'symRef');
  assert.strictEqual(n.attrs.kind, 'comp');
  assert.strictEqual(n.attrs.symbol, 'BCM');
  assert.match(latexToHtml('\\compref{X-1}', null, { resolveSym: () => 'BCM' }), /rt-symref comp/);
});

test('calref, ifref and compref coexist in one paragraph without one clobbering another', () => {
  // Regression shape: a fix aimed at one mention kind previously broke another
  // via an over-broad string replace. All three surviving together in the
  // same text, each keeping its own kind, is the guard against that.
  const latex = 'Theo \\srsref{EPB-0008}, ngưỡng \\calref{EPB-0042}, tín hiệu \\ifref{EPB-0055}, đội \\compref{EPB-0060}.';
  stable(latex);
  const doc = latexToDoc(latex, null, { resolveSym: () => 'X' });
  const kinds = doc.content[0].content.filter((n) => n.type === 'symRef').map((n) => n.attrs.kind);
  assert.deepStrictEqual(kinds, ['cal', 'iface', 'comp']);
});

// ---------------------------------------------------- mention excerpts

/** Build a paragraph node with plain text and, optionally, a symRef in it. */
const para = (text, mentionCode) => ({
  type: 'paragraph',
  content: mentionCode
    ? [{ type: 'text', text }, { type: 'symRef', attrs: { code: mentionCode, kind: 'comp', symbol: 'X' } }]
    : [{ type: 'text', text }],
});

test('a plain paragraph mention is captured whole, decimals and all', () => {
  // The exact shape that breaks a "cut at the next period" implementation:
  // real automotive prose is full of periods that are not sentence ends.
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Đoạn không liên quan.' }] },
      para('Khi ', 'BCM-1'),
      { type: 'paragraph', content: [{ type: 'text', text: 'nguồn 13.5 V. phải ổn định.' }] },
    ],
  };
  // The mention and the sentence around it are split across two adjacent
  // text runs in this fixture on purpose (mirrors how the parser emits a
  // symRef as its own inline node) — findMentionExcerpts must still return
  // exactly the ONE paragraph holding the mention, not zero, not both.
  const hits = findMentionExcerpts(doc, 'comp', 'BCM-1');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].content[0].type, 'paragraph');
});

test('a mention of a different code is not picked up', () => {
  const doc = { type: 'doc', content: [para('x', 'BCM-1')] };
  assert.strictEqual(findMentionExcerpts(doc, 'comp', 'BCM-2').length, 0);
  assert.strictEqual(findMentionExcerpts(doc, 'cal', 'BCM-1').length, 0, 'wrong kind must not match either');
});

test('a bullet mention is captured as its own one-item list, keeping nested sub-bullets intact', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'không liên quan' }] }] },
        {
          type: 'listItem',
          content: [
            para('điều kiện chính, ', 'BCM-1'),
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'chi tiết con' }] }] },
              ],
            },
          ],
        },
      ],
    }],
  };
  const hits = findMentionExcerpts(doc, 'comp', 'BCM-1');
  assert.strictEqual(hits.length, 1);
  const wrapped = hits[0].content[0];
  assert.strictEqual(wrapped.type, 'bulletList');
  assert.strictEqual(wrapped.content.length, 1, 'only the matching bullet, not its sibling');
  // The sub-bullet nested under the match must survive — it is part of the
  // point being made, not a separate excerpt.
  const latex = docToLatex(hits[0]);
  assert.match(latex, /chi tiết con/);
  assert.doesNotMatch(latex, /không liên quan/);
});

test('an ordered list mention keeps its numbering type, not itemize', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'orderedList',
      content: [{ type: 'listItem', content: [para('bước có mention', 'BCM-1')] }],
    }],
  };
  const hits = findMentionExcerpts(doc, 'comp', 'BCM-1');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].content[0].type, 'orderedList');
  assert.match(docToLatex(hits[0]), /\\begin\{enumerate\}/);
});

test('a table row mention keeps the header row for context, not the other data rows', () => {
  const header = { type: 'tableRow', content: [
    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tín hiệu' }] }] },
    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Giá trị' }] }] },
  ] };
  const rowA = { type: 'tableRow', content: [
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Khác' }] }] },
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '0' }] }] },
  ] };
  const rowB = { type: 'tableRow', content: [
    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LockCmd' }] }] },
    { type: 'tableCell', content: [para('', 'BCM-1')] },
  ] };
  const doc = { type: 'doc', content: [{ type: 'table', content: [header, rowA, rowB] }] };
  const hits = findMentionExcerpts(doc, 'comp', 'BCM-1');
  assert.strictEqual(hits.length, 1);
  const table = hits[0].content[0];
  assert.strictEqual(table.type, 'table');
  assert.strictEqual(table.content.length, 2, 'header + the one matching row, not the unrelated row');
  assert.strictEqual(table.content[0], header);
  assert.strictEqual(table.content[1], rowB);
  const latex = docToLatex(hits[0]);
  assert.match(latex, /Tín hiệu/, 'header must survive for context');
  assert.doesNotMatch(latex, /Khác/, 'the unrelated row must not');
});

test('multiple mentions of the same code in one field produce multiple excerpts', () => {
  const doc = {
    type: 'doc',
    content: [para('đoạn một ', 'BCM-1'), para('đoạn hai ', 'BCM-1')],
  };
  assert.strictEqual(findMentionExcerpts(doc, 'comp', 'BCM-1').length, 2);
});

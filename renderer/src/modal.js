'use strict';

/**
 * modal.js — in-app replacement for window.prompt().
 *
 * Electron does not implement prompt() at all; calling it throws
 * "prompt() is and will not be supported." Every feature that asked the user
 * for a string was therefore dead on arrival. These modals are also simply
 * better: they validate as you type and can show a hint.
 */

let openCount = 0;

function buildShell(titleText) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = titleText || '';
  const body = document.createElement('div');
  body.className = 'modal-body';
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  box.append(title, body, foot);
  backdrop.appendChild(box);
  return { backdrop, box, body, foot };
}

/**
 * Ask for a single line of text.
 * Resolves to the trimmed string, or null when cancelled.
 *
 * `validate(value)` may return a string to block submission with that message.
 */
export function askText(opts = {}) {
  const {
    title = 'Enter a value',
    label = '',
    value = '',
    placeholder = '',
    okLabel = 'OK',
    hint = '',
    allowEmpty = false,
    emptyLabel = null,      // when set, an extra button that resolves to ''
    validate = null,
    multiline = false,      // a textarea instead of a one-line input
    mono = false,
    wide = false,
  } = opts;

  return new Promise((resolve) => {
    const { backdrop, body, foot } = buildShell(title);

    if (label) {
      const l = document.createElement('label');
      l.className = 'modal-label';
      l.textContent = label;
      body.appendChild(l);
    }

    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.className = 'input' + (multiline ? ' modal-area' : '') + (mono ? ' mono' : '');
    input.value = value;
    input.placeholder = placeholder;
    body.appendChild(input);
    if (wide) backdrop.querySelector('.modal').classList.add('modal-wide');

    const msg = document.createElement('div');
    msg.className = 'modal-hint';
    msg.textContent = hint;
    body.appendChild(msg);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn';
    btnCancel.textContent = 'Cancel';

    const btnOk = document.createElement('button');
    btnOk.className = 'btn primary';
    btnOk.textContent = okLabel;

    foot.appendChild(btnCancel);
    if (emptyLabel) {
      const btnEmpty = document.createElement('button');
      btnEmpty.className = 'btn';
      btnEmpty.textContent = emptyLabel;
      btnEmpty.onclick = () => finish('');
      foot.appendChild(btnEmpty);
    }
    foot.appendChild(btnOk);

    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      openCount--;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(result);
    }

    function check() {
      const v = input.value.trim();
      let err = '';
      if (!v && !allowEmpty) err = '';
      else if (validate) err = validate(v) || '';
      msg.textContent = err || hint;
      msg.classList.toggle('error', !!err);
      input.classList.toggle('invalid', !!err);
      btnOk.disabled = !!err || (!v && !allowEmpty);
      return !btnOk.disabled;
    }

    function submit() {
      if (!check()) return;
      finish(input.value.trim());
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      // In a textarea Enter has to insert a newline; Ctrl+Enter submits.
      const submits = multiline ? (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) : e.key === 'Enter';
      if (submits) { e.preventDefault(); e.stopPropagation(); submit(); }
    }

    input.addEventListener('input', check);
    btnOk.onclick = submit;
    btnCancel.onclick = () => finish(null);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) finish(null); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    openCount++;
    check();
    input.focus();
    input.select();
  });
}

/**
 * Pick one entry from a list. `items` are { value, label, sub }.
 * Resolves to the chosen value, or null when cancelled.
 */
export function askChoice(opts = {}) {
  const { title = 'Choose', items = [], empty = 'No items.' } = opts;
  return new Promise((resolve) => {
    const { backdrop, body, foot } = buildShell(title);

    if (!items.length) {
      body.appendChild(Object.assign(document.createElement('div'),
        { className: 'modal-text', textContent: empty }));
    } else {
      const list = document.createElement('div');
      list.className = 'modal-list';
      items.forEach((it) => {
        const b = document.createElement('button');
        b.className = 'modal-list-item';
        b.innerHTML = '';
        const main = document.createElement('div');
        main.className = 'mli-main';
        main.textContent = it.label;
        b.appendChild(main);
        if (it.sub) {
          const sub = document.createElement('div');
          sub.className = 'mli-sub';
          sub.textContent = it.sub;
          b.appendChild(sub);
        }
        b.onclick = () => finish(it.value);
        list.appendChild(b);
      });
      body.appendChild(list);
    }

    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Close';
    foot.appendChild(cancel);

    let done = false;
    function finish(v) {
      if (done) return;
      done = true;
      openCount--;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    }
    cancel.onclick = () => finish(null);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) finish(null); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    openCount++;
    cancel.focus();
  });
}

/** Simple message box for things the user must acknowledge. */
export function showNotice(title, message) {
  return new Promise((resolve) => {
    const { backdrop, body, foot } = buildShell(title);
    const p = document.createElement('div');
    p.className = 'modal-text';
    p.textContent = message;
    body.appendChild(p);

    const ok = document.createElement('button');
    ok.className = 'btn primary';
    ok.textContent = 'Got it';
    foot.appendChild(ok);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      openCount--;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve();
    };
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(); }
    }
    ok.onclick = finish;
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) finish(); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    openCount++;
    ok.focus();
  });
}

export const modalOpen = () => openCount > 0;

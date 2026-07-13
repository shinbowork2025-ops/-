// モーダル・トースト・確認ダイアログ

export function toast(msg, ms = 2200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// contentHTML を下部シートとして表示。closeボタン(.modal-close)と背景タップで閉じる。
// onBeforeClose が false を返すと閉じない(入力途中の破棄確認用)。
export function openModal(contentHTML, { onBeforeClose } = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal-sheet">${contentHTML}</div>`;
  root.appendChild(backdrop);

  const tryClose = async () => {
    if (onBeforeClose && (await onBeforeClose()) === false) return;
    backdrop.remove();
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) tryClose(); });
  backdrop.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', tryClose));

  return {
    el: backdrop.querySelector('.modal-sheet'),
    close: () => backdrop.remove(),
    requestClose: tryClose,
  };
}

export function confirmDialog(message, { okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="confirm-msg"></div>
      <div class="btn-row">
        <button class="btn" data-act="cancel"></button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok"></button>
      </div>
    `);
    m.el.querySelector('.confirm-msg').textContent = message;
    m.el.querySelector('[data-act="cancel"]').textContent = cancelLabel;
    m.el.querySelector('[data-act="ok"]').textContent = okLabel;
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => { m.close(); resolve(false); });
    m.el.querySelector('[data-act="ok"]').addEventListener('click', () => { m.close(); resolve(true); });
  });
}

// 選択肢シート。選ばれたら value を、キャンセルなら null を返す。
export function actionSheet(title, items) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal-head"><h2></h2><button class="modal-close">✕</button></div>
      <div class="sheet-items"></div>
    `);
    m.el.querySelector('h2').textContent = title;
    const box = m.el.querySelector('.sheet-items');
    for (const it of items) {
      const b = document.createElement('button');
      b.className = `btn block mt8 ${it.cls || ''}`;
      b.textContent = it.label;
      b.addEventListener('click', () => { m.close(); resolve(it.value); });
      box.appendChild(b);
    }
    m.el.querySelector('.modal-close').addEventListener('click', () => resolve(null));
    m.el.closest('.modal-backdrop').addEventListener('click', function h(e) {
      if (e.target === this) resolve(null);
    });
  });
}

// 単一選択チップ群を作る。onChange(value)
export function chipGroup(container, options, selected, onChange) {
  container.innerHTML = '';
  container.classList.add('chips');
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (opt.value === selected ? ' on' : '');
    b.textContent = opt.label;
    b.addEventListener('click', () => {
      selected = opt.value;
      container.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
      b.classList.add('on');
      onChange(selected);
    });
    container.appendChild(b);
  }
}

// 複数選択チップ群。onChange(Set)
export function chipGroupMulti(container, options, selectedSet, onChange) {
  container.innerHTML = '';
  container.classList.add('chips');
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (selectedSet.has(opt.value) ? ' on' : '');
    b.textContent = opt.label;
    b.addEventListener('click', () => {
      if (selectedSet.has(opt.value)) { selectedSet.delete(opt.value); b.classList.remove('on'); }
      else { selectedSet.add(opt.value); b.classList.add('on'); }
      onChange(selectedSet);
    });
    container.appendChild(b);
  }
}

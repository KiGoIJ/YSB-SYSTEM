const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CASE_STORE = 'usb_v3_cases';
const COUNTER_STORE = 'usb_v3_counter';
const DB_NAME = 'usb_v3_documents_db';
const DB_VERSION = 1;
const DOC_STORE = 'documents';

let currentScreen = 'dashboard';
let cachedDocs = [];

const statusOrder = ['Новая', 'В работе', 'Ожидает сведений', 'На согласовании', 'Закрыта', 'Архив'];
const nextStatus = {
  'Новая': 'В работе',
  'В работе': 'Ожидает сведений',
  'Ожидает сведений': 'На согласовании',
  'На согласовании': 'Закрыта',
  'Закрыта': 'Архив',
  'Архив': 'Архив'
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function todayRu() { return new Date().toLocaleDateString('ru-RU'); }
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('ru-RU');
}
function fmtBytes(n) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = Number(n || 0), i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v.toFixed(0)} ${units[i]}` : `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function getCases() { return JSON.parse(localStorage.getItem(CASE_STORE) || '[]'); }
function setCases(items) { localStorage.setItem(CASE_STORE, JSON.stringify(items)); }
function getCounter() { return Number(localStorage.getItem(COUNTER_STORE) || '1'); }
function setCounter(v) { localStorage.setItem(COUNTER_STORE, String(Math.max(1, Number(v) || 1))); }
function nextNumber(consume = false) {
  const n = getCounter();
  const value = `УСБ–26–${String(n).padStart(4, '0')}`;
  if (consume) setCounter(n + 1);
  return value;
}
function overdue(item) { return item.deadline && !['Закрыта', 'Архив'].includes(item.status) && item.deadline < todayISO(); }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        const store = db.createObjectStore(DOC_STORE, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt');
        store.createIndex('category', 'category');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbAllDocs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readonly');
    const req = tx.objectStore(DOC_STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')));
    req.onerror = () => reject(req.error);
  });
}
async function dbPutDoc(doc) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).put(doc);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteDoc(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClearDocs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function showScreen(name) {
  currentScreen = name;
  $$('[data-screen]').forEach(x => x.classList.toggle('active', x.dataset.screen === name));
  $$('[data-nav]').forEach(x => x.classList.toggle('active', x.dataset.nav === name));
  location.hash = name;
  renderAll();
}
window.showScreen = showScreen;

function initNav() {
  $$('[data-nav]').forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.nav)));
  const hash = location.hash.replace('#', '');
  if (hash && $(`[data-screen="${hash}"]`)) showScreen(hash); else showScreen('dashboard');
  document.addEventListener('keydown', e => {
    if (e.altKey) {
      const map = { '1':'dashboard', '2':'intake', '3':'journal', '4':'documents', '5':'workflow', '6':'reports', '7':'settings' };
      if (map[e.key]) { e.preventDefault(); showScreen(map[e.key]); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); $('#commandInput')?.focus();
    }
  });
}
function initClock() {
  const el = $('#timebox');
  if (!el) return;
  const tick = () => { el.textContent = new Date().toLocaleString('ru-RU'); };
  tick(); setInterval(tick, 1000);
}

function renderMetrics() {
  const cases = getCases();
  const open = cases.filter(x => !['Закрыта', 'Архив'].includes(x.status));
  const late = cases.filter(overdue);
  const riskA = cases.filter(x => (x.category || '').startsWith('А'));
  const docSize = cachedDocs.reduce((s, x) => s + (x.fileSize || 0), 0);
  const data = [
    ['Дела', cases.length, 'в локальном журнале', ''],
    ['Открыто', open.length, 'требуют внимания', 'warn'],
    ['Просрочка', late.length, 'по сроку', 'danger'],
    ['Категория А', riskA.length, 'повышенный риск', 'danger'],
    ['Документы', cachedDocs.length, fmtBytes(docSize), 'ok'],
  ];
  const box = $('#metrics');
  if (!box) return;
  box.innerHTML = data.map(x => `<div class="metric ${x[3]}"><b>${x[1]}</b><span>${x[0]} – ${x[2]}</span></div>`).join('');
}
function renderDashboard() {
  const body = $('#recentCases');
  if (body) {
    const cases = getCases().slice(0, 6);
    body.innerHTML = cases.length ? cases.map(item => `
      <tr class="${overdue(item) ? 'overdue' : ''}">
        <td><span class="case-title">${item.number}</span><div class="sub">${fmtDate(item.created)}</div></td>
        <td>${catBadge(item.category)}</td>
        <td>${item.status}</td>
        <td>${item.target || ''}<div class="sub">${item.summary || ''}</div></td>
        <td>${item.deadline ? fmtDate(item.deadline) : ''}</td>
      </tr>`).join('') : '<tr><td colspan="5">Дел пока нет. Создайте первое дело во вкладке «Новое дело».</td></tr>';
  }
  const plan = $('#todayPlan');
  if (plan) {
    const cases = getCases();
    plan.innerHTML = `
      <div class="card"><h3>Просрочки</h3><p>Проверить дела с истекшим сроком: ${cases.filter(overdue).length}.</p></div>
      <div class="card"><h3>Ожидают сведений</h3><p>Проверить служебные запросы: ${cases.filter(x => x.status === 'Ожидает сведений').length}.</p></div>
      <div class="card"><h3>Документы</h3><p>Добавлено локально: ${cachedDocs.length}. Проверить категории и уровни доступа.</p></div>
    `;
  }
}

function formCase(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    id: uid(),
    number: data.number || nextNumber(false),
    created: data.created || todayISO(),
    category: data.category || 'C – стандартная',
    status: data.status || 'Новая',
    applicant: data.applicant || '',
    unit: data.unit || '',
    contact: data.contact || '',
    target: data.target || '',
    summary: data.summary || '',
    evidence: data.evidence || '',
    request: data.request || '',
    inspector: data.inspector || '',
    deadline: data.deadline || '',
    confidential: Boolean(data.confidential),
    history: [{ date: new Date().toISOString(), action: 'Создано дело' }]
  };
}
function caseText(item) {
  return [
    'КАРТОЧКА ДЕЛА УСБ',
    `Номер: ${item.number}`,
    `Дата регистрации: ${fmtDate(item.created)}`,
    `Категория: ${item.category}`,
    `Статус: ${item.status}`,
    `Срок: ${item.deadline ? fmtDate(item.deadline) : 'не указан'}`,
    `Инспектор: ${item.inspector || 'не назначен'}`,
    '',
    `Заявитель: ${item.applicant || 'не указано'}`,
    `Подразделение / роль: ${item.unit || 'не указано'}`,
    `Способ связи: ${item.contact || 'не указано'}`,
    `Конфиденциальность: ${item.confidential ? 'да' : 'нет'}`,
    '',
    `Объект / вопрос: ${item.target || 'не указано'}`,
    '',
    'Краткая суть:', item.summary || 'не указано',
    '',
    'Материалы / доказательства:', item.evidence || 'не указано',
    '',
    'Просьба заявителя:', item.request || 'проверить обстоятельства и принять решение в установленном порядке'
  ].join('\n');
}
function renderCasePreview() {
  const form = $('#caseForm');
  const out = $('#casePreview');
  if (!form || !out) return;
  out.textContent = caseText(formCase(form));
}
function initIntake() {
  const form = $('#caseForm');
  if (!form) return;
  const num = $('[name="number"]', form);
  num.value = nextNumber(false);
  $('[data-today]', form).value = todayISO();
  $('#newNumberBtn')?.addEventListener('click', () => { num.value = nextNumber(true); renderCasePreview(); });
  $('#resetCaseFormBtn')?.addEventListener('click', () => { form.reset(); num.value = nextNumber(false); $('[data-today]', form).value = todayISO(); renderCasePreview(); });
  form.addEventListener('input', renderCasePreview);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const item = formCase(form);
    if (item.number === nextNumber(false)) setCounter(getCounter() + 1);
    const cases = getCases(); cases.unshift(item); setCases(cases);
    form.reset(); num.value = nextNumber(false); $('[data-today]', form).value = todayISO();
    renderCasePreview(); showScreen('journal');
  });
  renderCasePreview();
}

function catBadge(cat = '') {
  const cls = cat.startsWith('А') ? 'a' : cat.startsWith('B') ? 'b' : 'c';
  return `<span class="badge ${cls}">${cat || 'C'}</span>`;
}
function renderJournal() {
  const body = $('#casesBody'); if (!body) return;
  const q = ($('#caseSearch')?.value || '').toLowerCase();
  const st = $('#caseStatus')?.value || 'Все';
  const cat = $('#caseCategory')?.value || 'Все';
  const list = getCases().filter(item => {
    const hay = `${item.number} ${item.category} ${item.status} ${item.applicant} ${item.unit} ${item.target} ${item.summary} ${item.inspector}`.toLowerCase();
    return (!q || hay.includes(q)) && (st === 'Все' || item.status === st) && (cat === 'Все' || (item.category || '').startsWith(cat));
  });
  $('#caseCount') && ($('#caseCount').textContent = String(list.length));
  body.innerHTML = list.length ? list.map(item => `
    <tr class="${overdue(item) ? 'overdue' : ''}">
      <td><span class="case-title">${item.number}</span><div class="sub">${fmtDate(item.created)}</div></td>
      <td>${catBadge(item.category)}</td>
      <td>${item.status}${overdue(item) ? '<div class="sub" style="color:var(--danger)">Просрочено</div>' : ''}</td>
      <td><b>${item.target || 'не указано'}</b><div class="sub">${item.summary || ''}</div></td>
      <td>${item.inspector || ''}<div class="sub">${item.deadline ? fmtDate(item.deadline) : ''}</div></td>
      <td class="actions"><button class="btn small" data-copy-case="${item.id}">Копировать</button><button class="btn small" data-next="${item.id}">Далее</button><button class="btn small" data-close="${item.id}">Закрыть</button><button class="btn small danger" data-delete="${item.id}">Удалить</button></td>
    </tr>`).join('') : '<tr><td colspan="6">Дела не найдены.</td></tr>';
  $$('[data-copy-case]').forEach(b => b.onclick = () => copyCase(b.dataset.copyCase));
  $$('[data-next]').forEach(b => b.onclick = () => changeStatus(b.dataset.next, 'next'));
  $$('[data-close]').forEach(b => b.onclick = () => changeStatus(b.dataset.close, 'Закрыта'));
  $$('[data-delete]').forEach(b => b.onclick = () => deleteCase(b.dataset.delete));
}
function copyCase(id) {
  const item = getCases().find(x => x.id === id); if (!item) return;
  navigator.clipboard.writeText(caseText(item));
  notify('Текст карточки скопирован.');
}
function changeStatus(id, mode) {
  const items = getCases(); const item = items.find(x => x.id === id); if (!item) return;
  item.status = mode === 'next' ? nextStatus[item.status] : mode;
  item.history = item.history || [];
  item.history.unshift({ date: new Date().toISOString(), action: `Статус: ${item.status}` });
  setCases(items); renderAll();
}
function deleteCase(id) {
  if (!confirm('Удалить дело из локального журнала?')) return;
  setCases(getCases().filter(x => x.id !== id)); renderAll();
}
function initJournal() {
  ['caseSearch', 'caseStatus', 'caseCategory'].forEach(id => $('#' + id)?.addEventListener('input', renderJournal));
}

async function reloadDocs() { cachedDocs = await dbAllDocs(); }
function docCardText(doc) {
  return [
    'КАРТОЧКА ДОКУМЕНТА',
    `Название: ${doc.title}`,
    `Категория: ${doc.category}`,
    `Уровень доступа: ${doc.access}`,
    `Файл: ${doc.fileName}`,
    `Тип: ${doc.fileType || 'не указан'}`,
    `Размер: ${fmtBytes(doc.fileSize)}`,
    `Добавлен: ${new Date(doc.addedAt).toLocaleString('ru-RU')}`,
    '',
    'Примечание:', doc.notes || 'без примечания',
    '',
    'Файл хранится локально в браузере. Система не предоставляет скачивание документов.'
  ].join('\n');
}
async function initDocs() {
  const form = $('#docForm');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const file = $('[name="docFile"]', form).files[0];
    if (!file) return alert('Выберите файл для добавления.');
    const data = Object.fromEntries(new FormData(form).entries());
    const doc = {
      id: uid(),
      title: data.docTitle || file.name,
      category: data.docCategory || 'Прочее',
      access: data.docAccess || 'Служебный',
      notes: data.docNotes || '',
      fileName: file.name,
      fileType: file.type || file.name.split('.').pop().toUpperCase(),
      fileSize: file.size,
      addedAt: new Date().toISOString(),
      blob: file
    };
    await dbPutDoc(doc);
    form.reset();
    await reloadDocs();
    renderAll();
    notify('Документ добавлен локально.');
  });
  ['docSearch','docCategoryFilter','docAccessFilter'].forEach(id => $('#' + id)?.addEventListener('input', renderDocuments));
  $('#clearDocsBtn')?.addEventListener('click', async () => {
    if (!confirm('Удалить все локально добавленные документы?')) return;
    await dbClearDocs(); await reloadDocs(); renderAll();
  });
  $('#copyDocsRegistryBtn')?.addEventListener('click', () => {
    const text = cachedDocs.map(d => `${d.title}; ${d.category}; ${d.access}; ${d.fileName}; ${fmtBytes(d.fileSize)}; ${new Date(d.addedAt).toLocaleString('ru-RU')}`).join('\n');
    navigator.clipboard.writeText(text || 'Документов нет.');
    notify('Реестр документов скопирован.');
  });
}
function renderDocuments() {
  const grid = $('#documentsGrid'); if (!grid) return;
  const q = ($('#docSearch')?.value || '').toLowerCase();
  const cat = $('#docCategoryFilter')?.value || 'Все';
  const access = $('#docAccessFilter')?.value || 'Все';
  const list = cachedDocs.filter(d => {
    const hay = `${d.title} ${d.category} ${d.access} ${d.fileName} ${d.notes}`.toLowerCase();
    return (!q || hay.includes(q)) && (cat === 'Все' || d.category === cat) && (access === 'Все' || d.access === access);
  });
  $('#docsCount') && ($('#docsCount').textContent = String(list.length));
  grid.innerHTML = list.length ? list.map(d => `
    <article class="doc-card">
      <div class="actions"><span class="badge">${d.category}</span><span class="badge">${d.access}</span><span class="badge">${fmtBytes(d.fileSize)}</span></div>
      <h3>${d.title}</h3>
      <p>${d.fileName}</p>
      <p>${d.notes || 'Без примечания.'}</p>
      <div class="actions"><button class="btn small" data-copy-doc="${d.id}">Копировать карточку</button><button class="btn small danger" data-delete-doc="${d.id}">Удалить</button></div>
    </article>`).join('') : '<div class="notice warn"><strong>Документы не добавлены.</strong>Используйте форму выше, чтобы добавить первый документ в локальное хранилище.</div>';
  $$('[data-copy-doc]').forEach(b => b.onclick = () => copyDocCard(b.dataset.copyDoc));
  $$('[data-delete-doc]').forEach(b => b.onclick = () => deleteDoc(b.dataset.deleteDoc));
}
function copyDocCard(id) {
  const doc = cachedDocs.find(x => x.id === id); if (!doc) return;
  navigator.clipboard.writeText(docCardText(doc)); notify('Карточка документа скопирована.');
}
async function deleteDoc(id) {
  if (!confirm('Удалить документ из локального хранилища?')) return;
  await dbDeleteDoc(id); await reloadDocs(); renderAll();
}

function renderReport() {
  const out = $('#reportOutput'); if (!out) return;
  const cases = getCases();
  const open = cases.filter(x => !['Закрыта','Архив'].includes(x.status));
  const late = cases.filter(overdue);
  const a = cases.filter(x => (x.category || '').startsWith('А'));
  const docSize = cachedDocs.reduce((s, x) => s + (x.fileSize || 0), 0);
  out.textContent = [
    'НЕДЕЛЬНАЯ СВОДКА УСБ',
    `Дата: ${todayRu()}`,
    '',
    `Дел всего: ${cases.length}`,
    `Открыто: ${open.length}`,
    `Просрочено: ${late.length}`,
    `Категория А: ${a.length}`,
    `Документов в локальном хранилище: ${cachedDocs.length}`,
    `Объем документов: ${fmtBytes(docSize)}`,
    '',
    'Просрочки:',
    ...(late.length ? late.map(x => `- ${x.number}: ${x.target || 'без темы'}, срок ${fmtDate(x.deadline)}, инспектор ${x.inspector || 'не назначен'}`) : ['- отсутствуют']),
    '',
    'Дела категории А:',
    ...(a.length ? a.map(x => `- ${x.number}: ${x.target || 'без темы'}, статус ${x.status}`) : ['- отсутствуют']),
    '',
    'Предложения:',
    '- обновить сроки по ожидающим делам;',
    '- проверить полноту карточек документов;',
    '- закрыть дела с утвержденными заключениями;',
    '- провести профилактику повторяющихся нарушений.'
  ].join('\n');
}
function initReports() {
  $('#copyReportBtn')?.addEventListener('click', () => { navigator.clipboard.writeText($('#reportOutput').textContent); notify('Отчет скопирован.'); });
}

function initSettings() {
  $('#copyCasesJsonBtn')?.addEventListener('click', () => { navigator.clipboard.writeText(JSON.stringify(getCases(), null, 2)); notify('JSON дел скопирован.'); });
  $('#importCasesJsonBtn')?.addEventListener('click', () => {
    const raw = prompt('Вставьте JSON-массив дел:');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('not array');
      setCases(data); renderAll(); notify('Дела импортированы.');
    } catch { alert('Некорректный JSON.'); }
  });
  $('#resetCounterBtn')?.addEventListener('click', () => { const n = prompt('Новый счетчик:', String(getCounter())); if (n) { setCounter(Number(n)); renderAll(); } });
  $('#clearCasesBtn')?.addEventListener('click', () => { if (confirm('Очистить локальный журнал дел?')) { setCases([]); renderAll(); } });
}

function initCommand() {
  const input = $('#commandInput'); const results = $('#commandResults');
  if (!input || !results) return;
  function render() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.remove('active'); results.innerHTML = ''; return; }
    const sections = [
      ['Сводка', 'dashboard', 'Главная панель контроля'],
      ['Новое дело', 'intake', 'Регистрация обращения'],
      ['Журнал дел', 'journal', 'Фильтры и статусы'],
      ['Документы', 'documents', 'Добавление локальных документов'],
      ['Регламент', 'workflow', 'Карта процесса'],
      ['Отчетность', 'reports', 'Сводка по журналу'],
      ['Настройки', 'settings', 'Бэкап и очистка']
    ].filter(x => x.join(' ').toLowerCase().includes(q));
    const cases = getCases().filter(x => `${x.number} ${x.target} ${x.summary} ${x.applicant}`.toLowerCase().includes(q)).slice(0, 5);
    const docs = cachedDocs.filter(x => `${x.title} ${x.category} ${x.fileName} ${x.notes}`.toLowerCase().includes(q)).slice(0, 5);
    results.innerHTML = [
      ...sections.map(x => `<div class="result-item" data-go="${x[1]}"><strong>${x[0]}</strong><span>${x[2]}</span></div>`),
      ...cases.map(x => `<div class="result-item" data-go="journal"><strong>${x.number} – ${x.target || 'дело'}</strong><span>${x.status}; ${x.summary || ''}</span></div>`),
      ...docs.map(x => `<div class="result-item" data-go="documents"><strong>${x.title}</strong><span>${x.category}; ${x.fileName}; без скачивания</span></div>`)
    ].join('') || '<div class="result-item"><strong>Ничего не найдено</strong><span>Измените запрос.</span></div>';
    results.classList.add('active');
    $$('[data-go]', results).forEach(el => el.onclick = () => { input.value = ''; results.classList.remove('active'); showScreen(el.dataset.go); });
  }
  input.addEventListener('input', render);
  input.addEventListener('blur', () => setTimeout(() => results.classList.remove('active'), 180));
}

function notify(text) {
  const n = $('#notify');
  if (!n) return alert(text);
  n.textContent = text;
  n.classList.remove('hidden');
  clearTimeout(n._timer);
  n._timer = setTimeout(() => n.classList.add('hidden'), 1800);
}

function renderAll() {
  renderMetrics();
  renderDashboard();
  renderJournal();
  renderDocuments();
  renderReport();
}

async function init() {
  initClock(); initNav(); initIntake(); initJournal(); initDocs(); initReports(); initSettings(); initCommand();
  await reloadDocs();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);

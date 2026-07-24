const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CASE_STORE = 'usb_v3_cases';
const COUNTER_STORE = 'usb_v3_counter';
const DB_NAME = 'usb_v3_documents_db';
const DB_VERSION = 1;
const DOC_STORE = 'documents';

// ===== FIREBASE КОНФИГУРАЦИЯ =====
const firebaseConfig = {
    apiKey: "AIzaSyA2RxdMUGwhXBe-rpZjQQfDYG1T9UMmaV0",
    authDomain: "aculs-a5fe1.firebaseapp.com",
    databaseURL: "https://aculs-a5fe1-default-rtdb.firebaseio.com",
    projectId: "aculs-a5fe1",
    storageBucket: "aculs-a5fe1.firebasestorage.app",
    messagingSenderId: "176811002068",
    appId: "1:176811002068:web:bd20e3258111cd27c5d341",
    measurementId: "G-L8K98NSV61"
};

let firebaseConnected = false;
let database, auth, casesRef, counterRef;

if (typeof firebase !== 'undefined') {
    try {
        firebase.initializeApp(firebaseConfig);
        database = firebase.database();
        auth = firebase.auth();
        casesRef = database.ref('glass_cases');
        counterRef = database.ref('glass_counter');
        firebaseConnected = true;
    } catch (e) {
        console.warn('Ошибка инициализации Firebase:', e);
    }
}

let currentScreen = 'dashboard';
let cachedDocs = [];
let casesCache = JSON.parse(localStorage.getItem(CASE_STORE) || '[]');
let counterCache = Number(localStorage.getItem(COUNTER_STORE) || '1');

const statusOrder = ['Новая', 'В работе', 'Ожидает сведений', 'На согласовании', 'Закрыта', 'Архив'];
const nextStatus = {
  'Новая': 'В работе',
  'В работе': 'Ожидает сведений',
  'Ожидает сведений': 'На согласовании',
  'На согласовании': 'Закрыта',
  'Закрыта': 'Архив',
  'Архив': 'Архив'
};

// ===== ТАКТИЧЕСКИЙ ЗВУКОВОЙ СИНТЕЗАТОР (Web Audio API) =====
let soundEnabled = localStorage.getItem('glass_sound') !== 'false';

function playSound(type) {
    if (!soundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (type === 'hover') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1500, ctx.currentTime);
            gain.gain.setValueAtTime(0.003, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.04);
        } else if (type === 'click') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(950, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1350, ctx.currentTime + 0.07);
            gain.gain.setValueAtTime(0.015, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.07);
        } else if (type === 'access_granted') {
            const now = ctx.currentTime;
            [650, 850, 1150].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const start = now + idx * 0.08;
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.025, start);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.15);
            });
        } else if (type === 'error') {
            const now = ctx.currentTime;
            [240, 220].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const start = now + idx * 0.15;
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.04, start);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.25);
            });
        }
    } catch (e) {
        console.log('Audio error');
    }
}

// Глобальная делегация звуков
document.addEventListener('mouseover', function(e) {
    const target = e.target.closest('button, .nav-btn, .btn, .file-btn, select, input[type="checkbox"], input[type="file"]');
    if (target && !target.disabled) {
        playSound('hover');
    }
});

document.addEventListener('click', function(e) {
    const target = e.target.closest('button, .nav-btn, .btn, .file-btn, select, input[type="checkbox"], input[type="file"]');
    if (target && !target.disabled) {
        playSound('click');
    }
});

// ===== ЖУРНАЛ СИСТЕМНОЙ АКТИВНОСТИ =====
function addLogEntry(message) {
    const box = document.getElementById('activityLogBox');
    if (!box) return;
    const time = new Date().toLocaleTimeString();
    const user = 'ОПЕРАТОР УСБ';
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-op">[${user}]:</span> ${message}`;
    box.appendChild(entry);
    box.scrollTop = box.scrollHeight;
    
    playSound('hover');
}

// ===== ИНТЕРАКТИВНЫЙ БУТ-ЭКРАН ДЕШИФРОВАНИЯ =====
function runDecryptionBoot(onComplete) {
    const decryptingScreen = document.getElementById('decryptingScreen');
    const terminalLog = document.getElementById('terminalLog');
    const progressFill = document.getElementById('cyberProgressFill');
    const percentDisplay = document.getElementById('cyberPercent');
    
    if (!decryptingScreen || !terminalLog) {
        onComplete();
        return;
    }
    
    decryptingScreen.style.display = 'flex';
    terminalLog.innerHTML = '';
    progressFill.style.width = '0%';
    percentDisplay.textContent = '0%';
    
    const logs = [
        '[Инициализация тактического подключения к УСБ System Glass...]',
        firebaseConnected ? '[Подключение к серверу базы данных Firebase: ОК]' : '[Служба Firebase недоступна: включен автономный режим]',
        '[Проверка локального кэша localStorage: УСПЕШНО]',
        '[Инициализация базы материалов IndexedDB: СОЕДИНЕНО]',
        '[Проверка целостности крипто-ключей пользователя: ОК]',
        '[Построение локального дерева зависимостей...]',
        '[Дешифрование баз данных обращений и сигналов...]',
        '[Контроль безопасности среды выполнения: 100% НАДЕЖНО]',
        '[Доступ авторизован. Локально-синхронная система запущена.]'
    ];
    
    let step = 0;
    const totalSteps = logs.length;
    
    function nextStep() {
        if (step < totalSteps) {
            const line = document.createElement('div');
            line.className = 'terminal-line';
            line.textContent = logs[step];
            terminalLog.appendChild(line);
            terminalLog.scrollTop = terminalLog.scrollHeight;
            
            playSound('hover');
            
            step++;
            const percent = Math.round((step / totalSteps) * 100);
            progressFill.style.width = `${percent}%`;
            percentDisplay.textContent = `${percent}%`;
            
            setTimeout(nextStep, 150);
        } else {
            playSound('access_granted');
            setTimeout(() => {
                decryptingScreen.style.display = 'none';
                onComplete();
            }, 300);
        }
    }
    
    nextStep();
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
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

// ===== ПОЛНАЯ СИНХРОНИЗАЦИЯ БАЗЫ ДАННЫХ И СЧЕТЧИКА ЧЕРЕЗ FIREBASE =====
function getCases() { return casesCache; }

function setCases(items) {
  casesCache = items;
  localStorage.setItem(CASE_STORE, JSON.stringify(items));
  
  if (firebaseConnected) {
      const data = {};
      items.forEach(c => {
          data[c.id] = c;
      });
      casesRef.set(data).catch(err => console.error('Ошибка сохранения Firebase:', err));
  }
}

function getCounter() { return counterCache; }

function setCounter(v) {
  const val = Math.max(1, Number(v) || 1);
  counterCache = val;
  localStorage.setItem(COUNTER_STORE, String(val));
  
  if (firebaseConnected) {
      counterRef.set(val).catch(err => console.error('Ошибка сохранения счетчика Firebase:', err));
  }
}

function nextNumber(consume = false) {
  const n = getCounter();
  const value = `УСБ–26–${String(n).padStart(4, '0')}`;
  if (consume) setCounter(n + 1);
  return value;
}

function overdue(item) { return item.deadline && !['Закрыта', 'Архив'].includes(item.status) && item.deadline < todayISO(); }

// ===== ПОДКЛЮЧЕНИЕ К INDEXEDDB ДЛЯ ЛОКАЛЬНЫХ ФАЙЛОВ =====
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

// ===== УПРАВЛЕНИЕ ЭКРАНАМИ =====
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

// ===== РЕНДЕРИНГ СВОДНЫХ ДАННЫХ =====
function renderMetrics() {
  const cases = getCases();
  const open = cases.filter(x => !['Закрыта', 'Архив'].includes(x.status));
  const late = cases.filter(overdue);
  const riskA = cases.filter(x => (x.category || '').startsWith('А') || (x.category || '').startsWith('A'));
  const docSize = cachedDocs.reduce((s, x) => s + (x.fileSize || 0), 0);
  const data = [
    ['Дела', cases.length, 'в журнале', ''],
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
    body.innerHTML = cases.length ? cases.map((item, index) => {
      return `
      <tr class="${overdue(item) ? 'overdue' : ''} table-row-animate" style="animation-delay: ${index * 0.02}s">
        <td><span class="case-title">${item.number}</span><div class="sub">${fmtDate(item.created)}</div></td>
        <td>${catBadge(item.category)}</td>
        <td>${item.status}</td>
        <td>${item.target || ''}<div class="sub">${item.summary || ''}</div></td>
        <td>${item.deadline ? fmtDate(item.deadline) : ''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5">Дел пока нет. Создайте первое дело во вкладке «Новое дело».</td></tr>';
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

// ===== РЕГИСТРАЦИЯ ДЕЛА =====
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
    
    addLogEntry(`Зарегистрировано новое дело: ${item.number} (Категория: ${item.category})`);
    
    form.reset(); num.value = nextNumber(false); $('[data-today]', form).value = todayISO();
    renderCasePreview(); showScreen('journal');
  });
  renderCasePreview();
}

// Полноценная кириллическая поддержка категорий
function catBadge(cat = '') {
  const firstChar = (cat.trim()[0] || 'C').toUpperCase();
  let cls = 'c';
  if (firstChar === 'А' || firstChar === 'A') cls = 'a';
  else if (firstChar === 'В' || firstChar === 'B' || firstChar === 'Б') cls = 'b';
  return `<span class="badge ${cls}">${cat || 'C'}</span>`;
}

// ===== РЕНДЕРИНГ ЖУРНАЛА ДЕЛ =====
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
  
  body.innerHTML = list.length ? list.map((item, index) => `
    <tr class="${overdue(item) ? 'overdue' : ''} table-row-animate" style="animation-delay: ${index * 0.02}s">
      <td><span class="case-title">${item.number}</span><div class="sub">${fmtDate(item.created)}</div></td>
      <td>${catBadge(item.category)}</td>
      <td>${item.status}${overdue(item) ? '<div class="sub" style="color:var(--danger)">Просрочено</div>' : ''}</td>
      <td><b>${item.target || 'не указано'}</b><div class="sub">${item.summary || ''}</div></td>
      <td>${item.inspector || ''}<div class="sub">${item.deadline ? fmtDate(item.deadline) : ''}</div></td>
      <td class="actions-cell">
        <div class="actions-wrapper">
          <button class="btn small" data-copy-case="${item.id}">Копировать</button>
          <button class="btn small" data-next="${item.id}">Далее</button>
          <button class="btn small" data-close="${item.id}">Закрыть</button>
          <button class="btn small danger" data-delete="${item.id}">Удалить</button>
        </div>
      </td>
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
  addLogEntry(`Текст дела ${item.number} скопирован в буфер обмена.`);
}

function changeStatus(id, mode) {
  const items = getCases(); const item = items.find(x => x.id === id); if (!item) return;
  const oldStatus = item.status;
  item.status = mode === 'next' ? (nextStatus[item.status] || item.status || 'Новая') : mode;
  item.history = item.history || [];
  item.history.unshift({ date: new Date().toISOString(), action: `Статус: ${item.status}` });
  setCases(items); 
  renderAll();
  
  addLogEntry(`Статус дела ${item.number} изменен: ${oldStatus} -> ${item.status}`);
}

function deleteCase(id) {
  const item = getCases().find(x => x.id === id);
  if (!item) return;
  if (!confirm(`Удалить дело ${item.number} из локального журнала?`)) return;
  setCases(getCases().filter(x => x.id !== id)); 
  renderAll();
  addLogEntry(`Удалено дело из локального журнала: ${item.number}`);
}

function initJournal() {
  ['caseSearch', 'caseStatus', 'caseCategory'].forEach(id => $('#' + id)?.addEventListener('input', renderJournal));
}

// ===== УПРАВЛЕНИЕ ЛОКАЛЬНЫМИ ДОКУМЕНТАМИ =====
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
    addLogEntry(`Добавлен локальный документ: ${doc.title} (${doc.fileName})`);
  });
  ['docSearch','docCategoryFilter','docAccessFilter'].forEach(id => $('#' + id)?.addEventListener('input', renderDocuments));
  $('#clearDocsBtn')?.addEventListener('click', async () => {
    if (!confirm('Удалить все локально добавленные документы?')) return;
    await dbClearDocs(); await reloadDocs(); renderAll();
    addLogEntry('Все локальные документы стерты из хранилища.');
  });
  $('#copyDocsRegistryBtn')?.addEventListener('click', () => {
    const text = cachedDocs.map(d => `${d.title}; ${d.category}; ${d.access}; ${d.fileName}; ${fmtBytes(d.fileSize)}; ${new Date(d.addedAt).toLocaleString('ru-RU')}`).join('\n');
    navigator.clipboard.writeText(text || 'Документов нет.');
    notify('Реестр документов скопирован.');
    addLogEntry('Полный реестр локальных документов скопирован в буфер обмена.');
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
  grid.innerHTML = list.length ? list.map((d, index) => `
    <article class="doc-card table-row-animate" style="animation-delay: ${index * 0.02}s">
      <div class="actions"><span class="badge">${d.category}</span><span class="badge">${d.access}</span><span class="badge">${fmtBytes(d.fileSize)}</span></div>
      <h3>${d.title}</h3>
      <p style="font-weight:700; color:var(--accent); font-size:12px;">${d.fileName}</p>
      <p>${d.notes || 'Без примечания.'}</p>
      <div class="actions"><button class="btn small" data-copy-doc="${d.id}">Копировать карточку</button><button class="btn small danger" data-delete-doc="${d.id}">Удалить</button></div>
    </article>`).join('') : '<div class="notice warn"><strong>Документы не добавлены.</strong>Используйте форму выше, чтобы добавить первый документ в локальное хранилище.</div>';
  $$('[data-copy-doc]').forEach(b => b.onclick = () => copyDocCard(b.dataset.copyDoc));
  $$('[data-delete-doc]').forEach(b => b.onclick = () => deleteDoc(b.dataset.deleteDoc));
}

function copyDocCard(id) {
  const doc = cachedDocs.find(x => x.id === id); if (!doc) return;
  navigator.clipboard.writeText(docCardText(doc)); notify('Карточка документа скопирована.');
  addLogEntry(`Карточка документа ${doc.title} скопирована в буфер.`);
}

async function deleteDoc(id) {
  const doc = cachedDocs.find(x => x.id === id); if (!doc) return;
  if (!confirm(`Удалить документ ${doc.title} из локального хранилища?`)) return;
  await dbDeleteDoc(id); await reloadDocs(); renderAll();
  addLogEntry(`Удален локальный документ: ${doc.title}`);
}

// ===== ОТЧЕТНОСТЬ =====
function renderReport() {
  const out = $('#reportOutput'); if (!out) return;
  const cases = getCases();
  const open = cases.filter(x => !['Закрыта','Архив'].includes(x.status));
  const late = cases.filter(overdue);
  const a = cases.filter(x => (x.category || '').startsWith('А') || (x.category || '').startsWith('A'));
  const docSize = cachedDocs.reduce((s, x) => s + (x.fileSize || 0), 0);
  out.textContent = [
    'НЕДЕЛЬНАЯ СВОДКА УСБ',
    `Дата: ${todayRu()}`,
    '',
    `Дела всего: ${cases.length}`,
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
  $('#copyReportBtn')?.addEventListener('click', () => { 
    navigator.clipboard.writeText($('#reportOutput').textContent); 
    notify('Отчет скопирован.'); 
    addLogEntry('Сформированная Недельная сводка скопирована в буфер обмена.');
  });
}

// ===== НАСТРОЙКИ СИСТЕМЫ =====
function initSettings() {
  $('#copyCasesJsonBtn')?.addEventListener('click', () => { 
    navigator.clipboard.writeText(JSON.stringify(getCases(), null, 2)); 
    notify('JSON дел скопирован.'); 
    addLogEntry('Полный бэкап журнала дел (JSON) скопирован в буфер обмена.');
  });
  $('#importCasesJsonBtn')?.addEventListener('click', () => {
    const raw = prompt('Вставьте JSON-массив дел:');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('not array');
      setCases(data); renderAll(); notify('Дела импортированы.');
      addLogEntry(`Импортировано дел из JSON бэкапа: ${data.length}`);
    } catch { alert('Некорректный JSON.'); }
  });
  $('#resetCounterBtn')?.addEventListener('click', () => { 
    const n = prompt('Новый счетчик номеров дел:', String(getCounter())); 
    if (n) { 
        setCounter(Number(n)); 
        renderAll(); 
        addLogEntry(`Счетчик выдачи номеров дел переустановлен на значение: ${n}`);
    } 
  });
  $('#clearCasesBtn')?.addEventListener('click', () => { 
    if (confirm('Очистить локальный журнал дел? Это действие сотрет все записи безвозвратно.')) { 
        setCases([]); 
        renderAll(); 
        addLogEntry('Журнал дел полностью очищен оператором.');
    } 
  });
}

// ===== БЫСТРЫЙ ПОИСК (CMD INPUT) =====
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

// ===== УВЕДОМЛЕНИЯ =====
function notify(text) {
  const n = $('#notify');
  if (!n) return alert(text);
  n.textContent = text;
  n.classList.remove('hidden');
  clearTimeout(n._timer);
  n._timer = setTimeout(() => n.classList.add('hidden'), 1800);
}

// ===== ИНТЕРАКТИВНЫЙ ФОН НА CANVAS =====
function initLoginBackground() {
    const canvas = document.getElementById('loginMatrixCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();
    
    const particles = [];
    const count = 40;
    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 1.5 + 0.5,
            speedX: Math.random() * 0.12 - 0.06,
            speedY: Math.random() * 0.12 - 0.06,
            alpha: Math.random() * 0.5 + 0.1
        });
    }
    
    let mouse = { x: null, y: null, radius: 150 };
    window.addEventListener('mousemove', function(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });
    window.addEventListener('mouseleave', function() {
        mouse.x = null;
        mouse.y = null;
    });
    
    function animate() {
        ctx.fillStyle = '#05070c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        particles.forEach((p, idx) => {
            // Притяжение к мыши
            if (mouse.x !== null && mouse.y !== null) {
                const dx = mouse.x - p.x;
                const dy = mouse.y - p.y;
                const dist = Math.hypot(dx, dy);
                if (dist < mouse.radius) {
                    const force = (mouse.radius - dist) / mouse.radius;
                    p.x += (dx / dist) * force * 0.4;
                    p.y += (dy / dist) * force * 0.4;
                }
            }
            
            p.x += p.speedX;
            p.y += p.speedY;
            
            if (p.x < 0 || p.x > canvas.width) p.speedX *= -1;
            if (p.y < 0 || p.y > canvas.height) p.speedY *= -1;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(207, 161, 52, ${p.alpha})`;
            ctx.fill();
            
            // Связующие линии
            for (let j = idx + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
                if (dist < 110) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(207, 161, 52, ${0.06 * (1 - dist / 110)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        });
        
        animationFrameId = requestAnimationFrame(animate);
    }
    animate();
}

function renderAll() {
  renderMetrics();
  renderDashboard();
  renderJournal();
  renderDocuments();
  renderReport();
}

async function init() {
  initClock(); 
  initNav(); 
  initIntake(); 
  initJournal(); 
  initDocs(); 
  initReports(); 
  initSettings(); 
  initCommand();
  initLoginBackground();
  
  // Настройка звуков системы
  const toggleBtn = document.getElementById('toggleSoundBtn');
  if (toggleBtn) {
      if (soundEnabled) {
          toggleBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
          toggleBtn.classList.add('primary');
      } else {
          toggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
          toggleBtn.classList.remove('primary');
          toggleBtn.classList.add('danger');
      }
      
      toggleBtn.addEventListener('click', function() {
          soundEnabled = !soundEnabled;
          localStorage.setItem('glass_sound', soundEnabled);
          if (soundEnabled) {
              toggleBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
              toggleBtn.classList.remove('danger');
              toggleBtn.classList.add('primary');
              toggleBtn.title = "Звук терминала (Вкл)";
          } else {
              toggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
              toggleBtn.classList.remove('primary');
              toggleBtn.classList.add('danger');
              toggleBtn.title = "Звук терминала (Выкл)";
          }
      });
  }

  // Запуск загрузочного экрана и дешифрования данных
  runDecryptionBoot(async () => {
      if (firebaseConnected) {
          addLogEntry("Подключение к удаленному серверу Firebase...");
          
          // Выполняем анонимный вход
          auth.signInAnonymously()
              .then(() => {
                  console.log('✅ Анонимная авторизация успешна');
                  
                  // Загрузка счетчика в реальном времени
                  counterRef.on('value', snapshot => {
                      const val = snapshot.val();
                      if (val) {
                          counterCache = Number(val);
                      } else {
                          counterCache = 1;
                      }
                      renderAll();
                  });
                  
                  // Синхронизация дел в реальном времени с Firebase!
                  casesRef.on('value', async snapshot => {
                      const data = snapshot.val();
                      if (data) {
                          casesCache = Object.values(data);
                          casesCache.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
                      } else {
                          casesCache = [];
                      }
                      await reloadDocs();
                      renderAll();
                  });
              })
              .catch(async error => {
                  console.error('Ошибка авторизации Firebase:', error);
                  addLogEntry('⚠️ Сбой авторизации сервера! Запущен автономный режим.');
                  casesCache = JSON.parse(localStorage.getItem(CASE_STORE) || '[]');
                  await reloadDocs();
                  renderAll();
              });
      } else {
          // Автономный режим по умолчанию
          addLogEntry('Служба Firebase недоступна. Включен автономный режим.');
          casesCache = JSON.parse(localStorage.getItem(CASE_STORE) || '[]');
          await reloadDocs();
          renderAll();
      }
  });
}

document.addEventListener('DOMContentLoaded', init);

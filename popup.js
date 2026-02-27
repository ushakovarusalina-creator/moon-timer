// ── The Moon Timer — popup.js ────────────────────────────────
const CIRCUM = 389.6;
const LAP    = 60 * 60;

let state  = null;
let ticker = null;

// ── messaging ─────────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      if (response) applyState(response);
      resolve(response);
    });
  });
}

// ── init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Static buttons
  document.getElementById('play-btn').addEventListener('click', toggleTimer);
  document.getElementById('btn-reset').addEventListener('click', () => sendMsg({ type: 'RESET' }));
  document.getElementById('badge-work').addEventListener('click', () => sendMsg({ type: 'SET_MODE', mode: 'work' }));
  document.getElementById('badge-break').addEventListener('click', () => sendMsg({ type: 'SET_MODE', mode: 'break' }));
  document.getElementById('btn-add-project').addEventListener('click', addProject);
  document.getElementById('proj-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addProject();
  });

  // Load initial state
  sendMsg({ type: 'GET_STATE' });
});

// ── apply state from background ───────────────────────────────
function applyState(s) {
  state = s;
  updateDisplay();
  updateBadges();
  updatePlayBtn();
  updateDots();
  renderProjects();
  updateProjLabel();
  if (state.running) startLocalTicker();
  else stopLocalTicker();
}

// ── local ticker for smooth display ──────────────────────────
function startLocalTicker() {
  stopLocalTicker();
  ticker = setInterval(() => {
    if (!state) return;
    state = { ...state, elapsed: state.elapsed + 1 };
    updateDisplay();
    if (state.mode === 'work' && state.elapsed > 0 && state.elapsed % LAP === 0) {
      stopLocalTicker();
      sendMsg({ type: 'GET_STATE' });
    }
  }, 1000);
}

function stopLocalTicker() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

// ── controls ──────────────────────────────────────────────────
function toggleTimer() {
  if (!state) return;
  sendMsg({ type: state.running ? 'PAUSE' : 'PLAY' });
}

function addProject() {
  const input = document.getElementById('proj-input');
  const name  = input.value.trim();
  if (!name) return;
  input.value = '';
  sendMsg({ type: 'ADD_PROJECT', name });
}

function removeProject(id) {
  sendMsg({ type: 'REMOVE_PROJECT', id });
}

function selectProject(id) {
  sendMsg({ type: 'SELECT_PROJECT', id });
}

function resetProjectTime(id) {
  sendMsg({ type: 'RESET_PROJECT_TIME', id });
}

// ── display ───────────────────────────────────────────────────
function updateDisplay() {
  if (!state) return;
  const base  = state.selectedProject !== null
    ? (state.projects.find(x => x.id === state.selectedProject)?.totalSeconds || 0)
    : 0;
  const total = base + state.elapsed;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const el = document.getElementById('time-display');
  el.textContent = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  el.className = 'time ' + (state.mode === 'work' ? 'work' : 'break') + (state.running ? ' running' : '');

  const progress = (total % LAP) / LAP;
  const ring = document.getElementById('ring');
  ring.style.strokeDashoffset = CIRCUM * (1 - progress);
  ring.style.stroke = state.mode === 'work' ? 'var(--work)' : 'var(--break)';
}

function updateBadges() {
  if (!state) return;
  document.getElementById('badge-work').className  = 'mode-badge' + (state.mode === 'work'  ? ' active-work'  : '');
  document.getElementById('badge-break').className = 'mode-badge' + (state.mode === 'break' ? ' active-break' : '');
}

function updatePlayBtn() {
  if (!state) return;
  const btn = document.getElementById('play-btn');
  btn.textContent = state.running ? '⏸' : '▶';
  btn.classList.toggle('break-mode', state.running && state.mode === 'break');
}

function updateDots() {
  if (!state) return;
  const n = state.completedSessions % 4 || (state.completedSessions > 0 ? 4 : 0);
  document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('done', i < n));
}

function updateProjLabel() {
  if (!state) return;
  const el = document.getElementById('proj-label');
  if (state.selectedProject !== null) {
    const p = state.projects.find(x => x.id === state.selectedProject);
    if (p) {
      el.innerHTML = 'Проект: <span>' + esc(p.name) + '</span>';
    } else {
      el.textContent = 'Проект не выбран';
    }
  } else {
    el.textContent = 'Проект не выбран';
  }
}

function renderProjects() {
  if (!state) return;
  const list = document.getElementById('proj-list');

  if (!state.projects.length) {
    list.innerHTML = '<div class="empty-msg">Нет проектов. Добавьте первый!</div>';
    return;
  }

  const maxSec = Math.max(...state.projects.map(p => p.totalSeconds), 1);

  // Build DOM manually to avoid innerHTML + event listeners conflict
  list.innerHTML = '';
  state.projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'project-item' + (state.selectedProject === p.id ? ' selected' : '');

    const dot = document.createElement('div');
    dot.className = 'project-dot';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;' + (p.totalSeconds > 0 ? 'padding-bottom:10px' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'project-name';
    nameEl.textContent = p.name;
    info.appendChild(nameEl);

    if (p.totalSeconds > 0) {
      const barPct  = Math.round(p.totalSeconds / maxSec * 100);
      const timeStr = fmtTime(p.totalSeconds);

      const bar = document.createElement('div');
      bar.className = 'project-time-bar';

      const fill = document.createElement('div');
      fill.className = 'project-time-fill';
      fill.style.width = barPct + '%';

      const label = document.createElement('span');
      label.className = 'project-time-label';
      label.textContent = '⏱ ' + timeStr;

      bar.appendChild(fill);
      bar.appendChild(label);
      info.appendChild(bar);
    }

    const btnReset = document.createElement('button');
    btnReset.className = 'btn-reset-time';
    btnReset.title = 'Сбросить время';
    btnReset.textContent = '↺';
    btnReset.addEventListener('click', e => { e.stopPropagation(); resetProjectTime(p.id); });

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-del';
    btnDel.title = 'Удалить';
    btnDel.textContent = '✕';
    btnDel.addEventListener('click', e => { e.stopPropagation(); removeProject(p.id); });

    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(btnReset);
    item.appendChild(btnDel);
    item.addEventListener('click', () => selectProject(p.id));

    list.appendChild(item);
  });
}

// ── utils ─────────────────────────────────────────────────────
function pad(n) { return n.toString().padStart(2, '0'); }

function fmtTime(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + 'ч ' + m + 'м';
  if (m > 0) return m + 'м ' + s + 'с';
  return s + 'с';
}

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let notifTimer;
function showNotif(msg) {
  const el = document.getElementById('notif');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// Push updates from background
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'STATE_UPDATE') applyState(msg.state);
  if (msg.type === 'NOTIFY') showNotif(msg.text);
});

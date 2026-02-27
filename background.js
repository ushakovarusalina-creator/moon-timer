// ── The Moon Timer — background service worker ───────────────

const DEFAULT_STATE = {
  running: false,
  mode: 'work',
  elapsed: 0,
  startedAt: null,
  selectedProject: null,
  projects: [],
  completedSessions: 0,
};

async function getState() {
  return new Promise(resolve => {
    chrome.storage.session.get('timerState', r => {
      resolve(r.timerState ? r.timerState : { ...DEFAULT_STATE });
    });
  });
}

async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  return new Promise(resolve => {
    chrome.storage.session.set({ timerState: next }, () => resolve(next));
  });
}

function liveElapsed(state) {
  if (!state.running || !state.startedAt) return state.elapsed;
  return state.elapsed + Math.floor((Date.now() - state.startedAt) / 1000);
}

function saveElapsedToProjects(projects, selectedProject, elapsed) {
  return projects.map(p =>
    p.id === selectedProject ? { ...p, totalSeconds: p.totalSeconds + elapsed } : p
  );
}

// Keep service worker alive with a periodic alarm
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'keepAlive') return;
  const state = await getState();
  if (!state.running) return;

  const live = liveElapsed(state);
  const LAP  = 60 * 60;
  const prevLaps = Math.floor(state.elapsed / LAP);
  const nowLaps  = Math.floor(live / LAP);

  if (state.mode === 'work' && nowLaps > prevLaps) {
    const projects = saveElapsedToProjects(state.projects, state.selectedProject, live);
    await setState({
      mode: 'break',
      elapsed: 0,
      startedAt: Date.now(),
      projects,
      completedSessions: state.completedSessions + 1,
    });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'The Moon Timer',
      message: '60 минут работы! Сделайте перерыв.',
    });
  } else {
    // Persist snapshot so elapsed survives SW restart
    await setState({ elapsed: live, startedAt: Date.now() });
  }
});

// ── message handler ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await getState();
    const LAP   = 60 * 60;

    if (msg.type === 'GET_STATE') {
      const live = liveElapsed(state);
      sendResponse({ ...state, elapsed: live });
      return;
    }

    if (msg.type === 'PLAY') {
      const next = await setState({ running: true, startedAt: Date.now() });
      sendResponse({ ...next });
      return;
    }

    if (msg.type === 'PAUSE') {
      const live = liveElapsed(state);
      let projects = state.projects;
      let elapsed  = live;
      if (state.mode === 'work' && live > 0) {
        projects = saveElapsedToProjects(state.projects, state.selectedProject, live);
        elapsed  = 0;
      }
      const next = await setState({ running: false, startedAt: null, elapsed, projects });
      sendResponse({ ...next, elapsed: state.mode === 'work' ? 0 : live });
      return;
    }

    if (msg.type === 'RESET') {
      const live = liveElapsed(state);
      let projects = state.projects;
      if (state.mode === 'work' && live > 0) {
        projects = saveElapsedToProjects(state.projects, state.selectedProject, live);
      }
      const next = await setState({ running: false, startedAt: null, elapsed: 0, projects });
      sendResponse({ ...next, elapsed: 0 });
      return;
    }

    if (msg.type === 'SET_MODE') {
      const live = liveElapsed(state);
      let projects = state.projects;
      if (state.mode === 'work' && live > 0) {
        projects = saveElapsedToProjects(state.projects, state.selectedProject, live);
      }
      const next = await setState({ mode: msg.mode, running: false, startedAt: null, elapsed: 0, projects });
      sendResponse({ ...next, elapsed: 0 });
      return;
    }

    if (msg.type === 'SELECT_PROJECT') {
      const live = liveElapsed(state);
      let projects = state.projects;
      if (state.mode === 'work' && live > 0) {
        projects = saveElapsedToProjects(state.projects, state.selectedProject, live);
      }
      const newSelected = state.selectedProject === msg.id ? null : msg.id;
      const next = await setState({
        selectedProject: newSelected,
        elapsed: 0,
        startedAt: state.running ? Date.now() : null,
        projects,
      });
      sendResponse({ ...next, elapsed: 0 });
      return;
    }

    if (msg.type === 'ADD_PROJECT') {
      const projects = [...state.projects, { id: Date.now(), name: msg.name, totalSeconds: 0 }];
      const next = await setState({ projects });
      sendResponse({ ...next, elapsed: liveElapsed(next) });
      return;
    }

    if (msg.type === 'REMOVE_PROJECT') {
      const projects       = state.projects.filter(p => p.id !== msg.id);
      const selectedProject = state.selectedProject === msg.id ? null : state.selectedProject;
      const next = await setState({ projects, selectedProject });
      sendResponse({ ...next, elapsed: liveElapsed(next) });
      return;
    }

    if (msg.type === 'RESET_PROJECT_TIME') {
      const live     = liveElapsed(state);
      const projects = state.projects.map(p => p.id === msg.id ? { ...p, totalSeconds: 0 } : p);
      const elapsed  = state.selectedProject === msg.id ? 0 : live;
      const startedAt = state.selectedProject === msg.id && state.running ? Date.now() : state.startedAt;
      const next = await setState({ projects, elapsed, startedAt });
      sendResponse({ ...next, elapsed: state.selectedProject === msg.id ? 0 : live });
      return;
    }

    sendResponse({ error: 'unknown message type' });
  })();
  return true; // keep port open
});

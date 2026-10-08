import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DEFAULT_CATEGORIES = [
  { workspace: 'office', name: 'Meetings', color: '#6366f1' },
  { workspace: 'office', name: 'Reports', color: '#0ea5e9' },
  { workspace: 'office', name: 'Clients', color: '#f59e0b' },
  { workspace: 'personal', name: 'Home', color: '#10b981' },
  { workspace: 'personal', name: 'Health', color: '#ef4444' },
  { workspace: 'personal', name: 'Shopping', color: '#ec4899' },
  { workspace: 'personal', name: 'Bills', color: '#8b5cf6' },
];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const WS_LABEL = { office: '💼 Office', personal: '🏠 Personal' };
const VIEW_TITLE = { today: 'Today', upcoming: 'Upcoming', all: 'All tasks', done: 'Completed' };

const state = {
  user: null,
  tasks: [],
  categories: [],
  view: 'today',
  ws: 'all',
  categoryId: null,
  search: '',
  sort: 'due',
  editingId: null,
  authMode: 'signin',
};

let supabase;
let channel;

// ---------- Small helpers ----------
function storageGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayStr() { return toDateStr(new Date()); }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}
function formatDate(dateStr) {
  const today = todayStr();
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  if (dateStr === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}
function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function show(section) {
  for (const id of ['setup-screen', 'auth-screen', 'app']) $('#' + id).hidden = id !== section;
}

// ---------- Startup ----------
init();

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
    show('setup-screen');
    return;
  }

  Object.assign(state, storageGet('todo.prefs', {}));
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  bindUI();

  let started = false;
  supabase.auth.onAuthStateChange((event, session) => {
    // Supabase calls made directly inside this callback can deadlock, so defer them
    if (event === 'PASSWORD_RECOVERY') setTimeout(handlePasswordRecovery, 0);
    const user = session?.user ?? null;
    if (started && user?.id === state.user?.id) return;
    started = true;
    state.user = user;
    setTimeout(() => (user ? startApp() : stopApp()), 0);
  });
}

function savePrefs() {
  const { view, ws, sort } = state;
  storageSet('todo.prefs', { view, ws, sort });
}

// ---------- Auth ----------
function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === 'signup';
  $('#auth-title').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-toggle').textContent = signup ? 'I already have an account' : 'Create an account';
  $('#auth-form [name=password]').autocomplete = signup ? 'new-password' : 'current-password';
  authMessage('');
}

function authMessage(text, kind = 'error') {
  const el = $('#auth-message');
  el.textContent = text;
  el.className = 'form-message ' + kind;
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const password = form.password.value;
  const btn = $('#auth-submit');
  btn.disabled = true;
  authMessage('');
  try {
    if (state.authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { emailRedirectTo: location.origin },
      });
      if (error) throw error;
      if (!data.session) {
        setAuthMode('signin');
        authMessage('Check your email and click the confirmation link, then sign in.', 'ok');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    authMessage(err.message || 'Something went wrong');
  } finally {
    btn.disabled = false;
  }
}

async function onForgotPassword() {
  const email = $('#auth-form [name=email]').value.trim();
  if (!email) { authMessage('Enter your email above first.'); return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) authMessage(error.message);
  else authMessage('Password reset link sent. Check your email.', 'ok');
}

async function handlePasswordRecovery() {
  const password = prompt('Enter a new password (at least 6 characters):');
  if (!password) return;
  const { error } = await supabase.auth.updateUser({ password });
  toast(error ? error.message : 'Password updated');
}

// ---------- App lifecycle ----------
async function startApp() {
  show('app');
  $('#user-email').textContent = state.user.email;

  // Show cached data instantly (also works offline), then refresh from the server
  const cache = storageGet('todo.cache.' + state.user.id, null);
  if (cache) {
    state.tasks = cache.tasks;
    state.categories = cache.categories;
  }
  render();
  await loadData();
  subscribeRealtime();
}

function stopApp() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  state.tasks = [];
  state.categories = [];
  state.categoryId = null;
  setAuthMode('signin');
  show('auth-screen');
}

async function loadData() {
  if (!state.user) return;
  setSyncStatus('Syncing…');
  const [cats, tasks] = await Promise.all([
    supabase.from('categories').select('*').order('created_at'),
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
  ]);
  if (cats.error || tasks.error) {
    setSyncStatus(navigator.onLine ? 'Sync failed' : 'Offline', true);
    return;
  }
  state.categories = cats.data;
  state.tasks = tasks.data;

  if (state.categories.length === 0 && !storageGet('todo.seeded.' + state.user.id, false)) {
    const { data, error } = await supabase.from('categories').insert(DEFAULT_CATEGORIES).select();
    if (!error) {
      state.categories = data;
      storageSet('todo.seeded.' + state.user.id, true);
    }
  }

  saveCache();
  setSyncStatus('');
  render();
}

function saveCache() {
  if (!state.user) return;
  storageSet('todo.cache.' + state.user.id, { tasks: state.tasks, categories: state.categories });
}

function subscribeRealtime() {
  if (channel) supabase.removeChannel(channel);
  const filter = `user_id=eq.${state.user.id}`;
  channel = supabase.channel('todo-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter }, p => applyChange('tasks', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter }, p => applyChange('categories', p))
    .subscribe();
}

function applyChange(table, payload) {
  const list = state[table];
  if (payload.eventType === 'DELETE') {
    state[table] = list.filter(r => r.id !== payload.old.id);
  } else {
    upsertLocal(table, payload.new);
  }
  saveCache();
  render();
}

function upsertLocal(table, row) {
  const i = state[table].findIndex(r => r.id === row.id);
  if (i >= 0) state[table][i] = row; else state[table].unshift(row);
}

function setSyncStatus(text, warn = false) {
  const el = $('#sync-status');
  if (!navigator.onLine) { text = 'Offline · read only'; warn = true; }
  el.textContent = text;
  el.classList.toggle('offline', warn);
}

function requireOnline() {
  if (navigator.onLine) return true;
  toast('You are offline. Changes need an internet connection.');
  return false;
}

// ---------- Filtering & sorting ----------
function baseFilter(task) {
  if (state.ws !== 'all' && task.workspace !== state.ws) return false;
  if (state.categoryId && task.category_id !== state.categoryId) return false;
  if (state.search) {
    const q = state.search.toLowerCase();
    if (!task.title.toLowerCase().includes(q) && !(task.notes || '').toLowerCase().includes(q)) return false;
  }
  return true;
}

function compareTasks(a, b) {
  const byDue = () =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
    (a.due_time || '99').localeCompare(b.due_time || '99');
  const byPriority = () => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (state.sort === 'priority') return byPriority() || byDue();
  if (state.sort === 'created') return b.created_at.localeCompare(a.created_at);
  return byDue() || byPriority();
}

function buildGroups() {
  const today = todayStr();
  const tasks = state.tasks.filter(baseFilter);
  const open = tasks.filter(t => t.status !== 'done').sort(compareTasks);

  switch (state.view) {
    case 'today':
      return [
        { title: 'Overdue', cls: 'overdue', items: open.filter(t => t.due_date && t.due_date < today) },
        { title: 'Today', items: open.filter(t => t.due_date === today) },
      ];
    case 'upcoming': {
      const groups = new Map();
      for (const t of open.filter(t => t.due_date && t.due_date > today)) {
        const key = t.due_date;
        if (!groups.has(key)) groups.set(key, { title: formatDate(key), items: [] });
        groups.get(key).items.push(t);
      }
      return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
    }
    case 'done':
      return [{
        title: 'Completed',
        items: tasks.filter(t => t.status === 'done')
          .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))
          .slice(0, 200),
      }];
    default:
      return [
        { title: 'In progress', items: open.filter(t => t.status === 'in_progress') },
        { title: 'To do', items: open.filter(t => t.status === 'todo') },
      ];
  }
}

// ---------- Rendering ----------
function render() {
  if (!state.user) return;

  $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $$('.segmented button').forEach(b => b.classList.toggle('active', b.dataset.ws === state.ws));
  $('#sort').value = state.sort;
  $('#view-title').textContent = VIEW_TITLE[state.view];

  renderCounts();
  renderCategoryList();
  renderActiveFilter();

  const groups = buildGroups().filter(g => g.items.length);
  const container = $('#task-container');
  if (!groups.length) {
    container.innerHTML = emptyState();
    return;
  }
  container.innerHTML = groups.map(g => `
    <section>
      <h2 class="group-title ${g.cls || ''}">${esc(g.title)} · ${g.items.length}</h2>
      <ul class="task-list">${g.items.map(taskHTML).join('')}</ul>
    </section>`).join('');
}

function renderCounts() {
  const today = todayStr();
  const ws = t => state.ws === 'all' || t.workspace === state.ws;
  const open = state.tasks.filter(t => t.status !== 'done' && ws(t));
  const overdue = open.filter(t => t.due_date && t.due_date < today).length;
  const counts = {
    today: open.filter(t => t.due_date && t.due_date <= today).length,
    upcoming: open.filter(t => t.due_date && t.due_date > today).length,
    all: open.length,
  };
  for (const [key, n] of Object.entries(counts)) {
    const el = $(`[data-count="${key}"]`);
    el.textContent = n || '';
    el.classList.toggle('alert', key === 'today' && overdue > 0);
  }
}

function renderCategoryList() {
  const cats = state.categories.filter(c => state.ws === 'all' || c.workspace === state.ws);
  $('#category-list').innerHTML = cats.map(c => `
    <li><button data-cat="${c.id}" class="${c.id === state.categoryId ? 'active' : ''}">
      <span class="dot" style="background:${esc(c.color)}"></span>
      <span>${esc(c.name)}</span>
      ${state.ws === 'all' ? `<span class="ws-label">${c.workspace === 'office' ? '💼' : '🏠'}</span>` : ''}
    </button></li>`).join('') || '<li class="muted small" style="padding:0 12px">No categories yet</li>';
}

function renderActiveFilter() {
  const cat = state.categories.find(c => c.id === state.categoryId);
  const el = $('#active-filter');
  el.hidden = !cat;
  if (cat) {
    el.innerHTML = `<span class="muted">Filtered by</span>
      <span class="chip"><span class="dot" style="background:${esc(cat.color)}"></span>${esc(cat.name)}
      <button id="clear-cat" aria-label="Clear category filter">✕</button></span>`;
  }
}

function taskHTML(t) {
  const today = todayStr();
  const cat = state.categories.find(c => c.id === t.category_id);
  const done = t.status === 'done';
  const meta = [];

  if (state.ws === 'all') meta.push(`<span class="chip ws-${t.workspace}">${WS_LABEL[t.workspace]}</span>`);
  if (cat) meta.push(`<span class="chip"><span class="dot" style="background:${esc(cat.color)}"></span>${esc(cat.name)}</span>`);
  if (t.due_date) {
    const cls = !done && t.due_date < today ? 'overdue' : t.due_date === today ? 'today' : '';
    const time = t.due_time ? ' · ' + formatTime(t.due_time) : '';
    meta.push(`<span class="chip ${cls}">📅 ${esc(formatDate(t.due_date) + time)}</span>`);
  }
  if (t.status === 'in_progress') meta.push('<span class="chip progress">In progress</span>');
  if (t.priority === 'high') meta.push('<span class="chip overdue">High</span>');

  return `
    <li class="task p-${t.priority} ${done ? 'done' : ''}" data-id="${t.id}">
      <button class="check" data-toggle aria-label="${done ? 'Mark as not done' : 'Mark as done'}">${done ? '✓' : ''}</button>
      <div class="task-body">
        <span class="task-title">${esc(t.title)}</span>
        ${t.notes ? `<span class="task-notes">${esc(t.notes)}</span>` : ''}
        ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
      </div>
    </li>`;
}

function emptyState() {
  if (state.search) return `<div class="empty"><div class="big">🔍</div><p>No tasks match “${esc(state.search)}”.</p></div>`;
  const msg = {
    today: ['🎉', 'Nothing due today. Enjoy!'],
    upcoming: ['📅', 'No upcoming tasks with a due date.'],
    all: ['📝', 'No open tasks. Tap + to add one.'],
    done: ['✅', 'No completed tasks yet.'],
  }[state.view];
  return `<div class="empty"><div class="big">${msg[0]}</div><p>${msg[1]}</p></div>`;
}

// ---------- Task actions ----------
async function toggleDone(id) {
  if (!requireOnline()) return;
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const prev = { ...task };
  const status = task.status === 'done' ? 'todo' : 'done';
  Object.assign(task, { status, completed_at: status === 'done' ? new Date().toISOString() : null });
  render();

  const { data, error } = await supabase.from('tasks').update({ status }).eq('id', id).select().single();
  if (error) {
    Object.assign(task, prev);
    render();
    toast('Could not update task');
    return;
  }
  upsertLocal('tasks', data);
  saveCache();
  if (status === 'done') toast('Task completed 🎉');
}

function fillCategoryOptions(workspace, selected) {
  const options = state.categories.filter(c => c.workspace === workspace);
  $('#task-form [name=category_id]').innerHTML =
    '<option value="">No category</option>' +
    options.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function openTaskDialog(task = null) {
  const form = $('#task-form');
  form.reset();
  state.editingId = task?.id ?? null;
  $('#task-dialog-title').textContent = task ? 'Edit task' : 'New task';
  $('#delete-task').hidden = !task;

  // New tasks default to the current workspace / category / view
  const defaultCat = state.categories.find(c => c.id === state.categoryId);
  const workspace = task?.workspace ?? defaultCat?.workspace ?? (state.ws === 'all' ? 'office' : state.ws);
  form.title.value = task?.title ?? '';
  form.notes.value = task?.notes ?? '';
  form.querySelector(`[name=workspace][value=${workspace}]`).checked = true;
  fillCategoryOptions(workspace, task ? task.category_id : defaultCat?.id);
  form.priority.value = task?.priority ?? 'medium';
  form.status.value = task?.status ?? 'todo';
  form.due_date.value = task ? (task.due_date ?? '') : (state.view === 'today' ? todayStr() : '');
  form.due_time.value = task?.due_time?.slice(0, 5) ?? '';

  $('#task-dialog').showModal();
  if (!task) form.title.focus();
}

async function onTaskSubmit(e) {
  e.preventDefault();
  if (!requireOnline()) return;
  const form = e.target;
  const payload = {
    title: form.title.value.trim(),
    notes: form.notes.value.trim() || null,
    workspace: form.querySelector('[name=workspace]:checked').value,
    category_id: form.category_id.value || null,
    priority: form.priority.value,
    status: form.status.value,
    due_date: form.due_date.value || null,
    due_time: form.due_time.value || null,
  };
  if (!payload.title) return;

  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  const query = state.editingId
    ? supabase.from('tasks').update(payload).eq('id', state.editingId)
    : supabase.from('tasks').insert(payload);
  const { data, error } = await query.select().single();
  submit.disabled = false;

  if (error) { toast('Could not save: ' + error.message); return; }
  upsertLocal('tasks', data);
  saveCache();
  render();
  $('#task-dialog').close();
  toast(state.editingId ? 'Task updated' : 'Task added');
}

async function onDeleteTask() {
  if (!state.editingId || !requireOnline()) return;
  if (!confirm('Delete this task?')) return;
  const { error } = await supabase.from('tasks').delete().eq('id', state.editingId);
  if (error) { toast('Could not delete task'); return; }
  state.tasks = state.tasks.filter(t => t.id !== state.editingId);
  saveCache();
  render();
  $('#task-dialog').close();
  toast('Task deleted');
}

// ---------- Categories ----------
function renderCategoryManager() {
  $('#category-manager').innerHTML = ['office', 'personal'].map(ws => {
    const cats = state.categories.filter(c => c.workspace === ws);
    return `<div class="cat-group"><h3>${WS_LABEL[ws]}</h3>${
      cats.map(c => `
        <div class="cat-row">
          <span class="dot" style="background:${esc(c.color)}"></span>
          <span class="name">${esc(c.name)}</span>
          <button class="icon-btn small" data-delete-cat="${c.id}" aria-label="Delete ${esc(c.name)}">🗑️</button>
        </div>`).join('') || '<p class="muted small">No categories</p>'
    }</div>`;
  }).join('');
}

async function onCategorySubmit(e) {
  e.preventDefault();
  if (!requireOnline()) return;
  const form = e.target;
  const { data, error } = await supabase.from('categories')
    .insert({ workspace: form.workspace.value, name: form.name.value.trim(), color: form.color.value })
    .select().single();
  if (error) { toast('Could not add category'); return; }
  state.categories.push(data);
  form.name.value = '';
  saveCache();
  renderCategoryManager();
  render();
}

async function onDeleteCategory(id) {
  if (!requireOnline()) return;
  const cat = state.categories.find(c => c.id === id);
  if (!cat || !confirm(`Delete category "${cat.name}"? Its tasks will be kept without a category.`)) return;
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) { toast('Could not delete category'); return; }
  state.categories = state.categories.filter(c => c.id !== id);
  state.tasks.forEach(t => { if (t.category_id === id) t.category_id = null; });
  if (state.categoryId === id) state.categoryId = null;
  saveCache();
  renderCategoryManager();
  render();
}

// ---------- Event wiring ----------
function bindUI() {
  $('#auth-form').addEventListener('submit', onAuthSubmit);
  $('#auth-toggle').addEventListener('click', () => setAuthMode(state.authMode === 'signup' ? 'signin' : 'signup'));
  $('#auth-forgot').addEventListener('click', onForgotPassword);
  $('#sign-out').addEventListener('click', () => {
    document.body.classList.remove('drawer-open');
    supabase.auth.signOut();
  });

  $$('.view-btn').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.body.classList.remove('drawer-open');
    savePrefs();
    render();
    window.scrollTo({ top: 0 });
  }));

  $$('.segmented button').forEach(b => b.addEventListener('click', () => {
    state.ws = b.dataset.ws;
    const cat = state.categories.find(c => c.id === state.categoryId);
    if (cat && state.ws !== 'all' && cat.workspace !== state.ws) state.categoryId = null;
    savePrefs();
    render();
  }));

  $('#search').addEventListener('input', e => { state.search = e.target.value.trim(); render(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; savePrefs(); render(); });

  $('#category-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.categoryId = state.categoryId === btn.dataset.cat ? null : btn.dataset.cat;
    document.body.classList.remove('drawer-open');
    render();
  });
  $('#active-filter').addEventListener('click', e => {
    if (e.target.closest('#clear-cat')) { state.categoryId = null; render(); }
  });

  $('#task-container').addEventListener('click', e => {
    const li = e.target.closest('.task');
    if (!li) return;
    if (e.target.closest('[data-toggle]')) toggleDone(li.dataset.id);
    else openTaskDialog(state.tasks.find(t => t.id === li.dataset.id));
  });

  $('#add-task').addEventListener('click', () => openTaskDialog());
  $('#task-form').addEventListener('submit', onTaskSubmit);
  $('#delete-task').addEventListener('click', onDeleteTask);
  $$('#task-form [name=workspace]').forEach(r =>
    r.addEventListener('change', () => fillCategoryOptions(r.value, null)));

  $('#manage-categories').addEventListener('click', () => {
    document.body.classList.remove('drawer-open');
    renderCategoryManager();
    $('#category-dialog').showModal();
  });
  $('#category-form').addEventListener('submit', onCategorySubmit);
  $('#category-manager').addEventListener('click', e => {
    const btn = e.target.closest('[data-delete-cat]');
    if (btn) onDeleteCategory(btn.dataset.deleteCat);
  });

  // Close buttons and backdrop clicks for dialogs
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  // Mobile drawer
  $('#mobile-menu').addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.toggle('drawer-open');
  });
  document.addEventListener('click', e => {
    if (document.body.classList.contains('drawer-open') && !e.target.closest('.sidebar')) {
      document.body.classList.remove('drawer-open');
    }
  });

  // Keyboard shortcut (desktop): "n" for new task
  document.addEventListener('keydown', e => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && state.user &&
        !document.querySelector('dialog[open]') && !e.target.closest('input, textarea, select')) {
      e.preventDefault();
      openTaskDialog();
    }
  });

  // Keep in sync when coming back online or returning to the app
  window.addEventListener('online', () => { setSyncStatus(''); loadData(); });
  window.addEventListener('offline', () => setSyncStatus(''));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) { loadData(); render(); }
  });
}

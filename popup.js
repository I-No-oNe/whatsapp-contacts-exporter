// Popup: connect to WhatsApp, pick a group, export its participants.

let groups = [];
let selectedId = '';
let participants = []; // members with a number or a public name (no empty rows)
let hiddenCount = 0;   // members whose number is hidden
let groupName = '';
let tabId = null;
let renderedCount = 0;
const PAGE = 150;

const $ = (id) => document.getElementById(id);
const statusEl = $('status'), bannerEl = $('banner'), listEl = $('list'), emptyEl = $('empty'), summaryEl = $('summary');
const retryBtn = $('retry'), filterEl = $('filter');
const comboBtn = $('comboBtn'), comboLabel = $('comboLabel'), comboPanel = $('comboPanel');
const comboSearch = $('comboSearch'), comboList = $('comboList'), comboEmpty = $('comboEmpty');
const xlsxBtn = $('xlsx'), csvBtn = $('csv'), copyBtn = $('copy');
const progressEl = $('progress'), statCount = $('statCount');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function setStatus(text, cls) {
  statusEl.innerHTML = `<span class="pulse ${cls || ''}"></span>` + esc(text);
}
// Success/failure banner.
function banner(ok, text) {
  bannerEl.className = 'banner ' + (ok ? 'ok' : 'bad');
  bannerEl.textContent = text;
  bannerEl.hidden = false;
  void bannerEl.offsetWidth;
  bannerEl.classList.add('pop');
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hiddenText = () => hiddenCount
  ? `${plural(hiddenCount, 'member hides', 'members hide')} their number` : 'No members hide their number';

async function wa(op, args) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'WA', op, args });
  if (!res?.ok) throw new Error(res?.error || 'No response from WhatsApp tab');
  return res.result;
}

// Group picker

let shown = [];
let active = -1;

function highlight(name, q) {
  const i = q ? name.toLowerCase().indexOf(q) : -1;
  if (i < 0) return esc(name);
  return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
}

function renderGroups() {
  const q = comboSearch.value.trim().toLowerCase();
  shown = groups.filter((g) => g.name.toLowerCase().includes(q));
  comboList.innerHTML = shown.map((g, i) =>
    `<li role="option" id="opt${i}" data-i="${i}" aria-selected="${g.id === selectedId}">` +
    `<span class="opt-name">${highlight(g.name, q)}</span>` +
    (g.size ? `<span class="opt-size">${g.size}</span>` : '') + '</li>').join('');
  comboEmpty.hidden = shown.length > 0;
  setActive(Math.max(0, shown.findIndex((g) => g.id === selectedId)));
}

function setActive(i) {
  if (!shown.length) { active = -1; comboSearch.removeAttribute('aria-activedescendant'); return; }
  active = (i + shown.length) % shown.length;
  comboList.querySelector('.active')?.classList.remove('active');
  const li = $('opt' + active);
  li.classList.add('active');
  li.scrollIntoView({ block: 'nearest' });
  comboSearch.setAttribute('aria-activedescendant', li.id);
}

function openCombo() {
  comboPanel.hidden = false;
  comboBtn.setAttribute('aria-expanded', 'true');
  comboSearch.value = '';
  renderGroups();
  comboSearch.focus();
}
function closeCombo(refocus) {
  if (comboPanel.hidden) return;
  comboPanel.hidden = true;
  comboBtn.setAttribute('aria-expanded', 'false');
  if (refocus) comboBtn.focus();
}
function choose(g) {
  if (!g) return;
  closeCombo(true);
  comboLabel.textContent = g.name;
  comboLabel.classList.remove('placeholder');
  if (g.id !== selectedId) { selectedId = g.id; loadGroup(g); }
}

comboBtn.onclick = () => (comboPanel.hidden ? openCombo() : closeCombo(true));
comboSearch.addEventListener('input', renderGroups);
comboSearch.addEventListener('keydown', (e) => {
  const keys = {
    ArrowDown: () => setActive(active + 1),
    ArrowUp: () => setActive(active - 1),
    Home: () => setActive(0),
    End: () => setActive(-1),
    Enter: () => choose(shown[active]),
    Escape: () => closeCombo(true),
    Tab: () => closeCombo(false),
  };
  if (!keys[e.key]) return;
  if (e.key !== 'Tab') e.preventDefault();
  keys[e.key]();
});
comboList.addEventListener('mousemove', (e) => {
  const li = e.target.closest('li');
  if (li && +li.dataset.i !== active) setActive(+li.dataset.i);
});
comboList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) choose(shown[+li.dataset.i]);
});
document.addEventListener('mousedown', (e) => {
  if (!$('combo').contains(e.target)) closeCombo(false);
});

// Participants

function filtered() {
  const f = filterEl.value.trim().toLowerCase();
  if (!f) return participants;
  return participants.filter((p) => p.name.toLowerCase().includes(f) || p.number.includes(f));
}

function render(reset) {
  if (reset) { renderedCount = 0; listEl.innerHTML = ''; }
  const items = filtered();
  statCount.textContent = items.length;
  emptyEl.classList.toggle('hide', items.length > 0);
  const frag = document.createDocumentFragment();
  const end = Math.min(items.length, renderedCount + PAGE);
  for (let i = renderedCount; i < end; i++) {
    const p = items[i];
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = (p.name.trim()[0] || '#').toUpperCase();
    const div = document.createElement('div');
    div.innerHTML = `<div class="nm${p.name ? '' : ' dim'}">${esc(p.name || 'No name set')}</div><div class="ph">${esc(p.number || 'Number hidden')}</div>`;
    li.append(av, div);
    frag.appendChild(li);
  }
  listEl.appendChild(frag);
  renderedCount = end;
}

listEl.addEventListener('scroll', () => {
  if (listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 200) render(false);
}, { passive: true });

let filterT = null;
filterEl.addEventListener('input', () => {
  clearTimeout(filterT);
  filterT = setTimeout(() => render(true), 120);
});

function setExports(on) {
  xlsxBtn.disabled = csvBtn.disabled = copyBtn.disabled = !on;
}

async function connect() {
  retryBtn.hidden = true;
  progressEl.style.width = '30%';
  setStatus('Connecting to WhatsApp...');
  try {
    const tab = (await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }))[0];
    if (!tab) throw new Error('Open web.whatsapp.com and log in first');
    tabId = tab.id;
    // Tabs opened before install/reload don't have the scripts yet.
    const [probe] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => !!window.WPP }).catch(() => []);
    if (!probe?.result) { // loading wa-js twice breaks it
      await chrome.scripting.executeScript({ target: { tabId }, files: ['wpp-config.js', 'lib/wppconnect-wa.js', 'main.js'], world: 'MAIN' }).catch(() => {});
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
    groups = await wa('groups');
    if (!groups.length) throw new Error('Connected, but no groups found. Wait for chats to load and try again');
    comboLabel.textContent = 'Choose a group';
    comboLabel.classList.add('placeholder');
    comboBtn.disabled = false;
    progressEl.style.width = '100%';
    setStatus('Connected to WhatsApp', 'ok');
    banner(true, `WhatsApp connected, ${plural(groups.length, 'group', 'groups')} found`);
  } catch (e) {
    progressEl.style.width = '0';
    setStatus('Not connected', 'bad');
    banner(false, e.message.includes('Receiving end') ? 'Could not reach the WhatsApp tab. Reload it and try again' : e.message);
    comboLabel.textContent = 'Not connected';
    retryBtn.hidden = false;
  }
}

async function loadGroup(g) {
  participants = [];
  hiddenCount = 0;
  summaryEl.hidden = true;
  setExports(false);
  render(true);
  groupName = g.name;
  comboBtn.disabled = true;
  progressEl.style.width = '50%';
  setStatus('Loading participants...');
  try {
    const all = await wa('participants', { id: g.id });
    participants = all.filter((p) => p.number || p.name)
      .sort((a, b) => !a.name - !b.name || a.name.localeCompare(b.name)); // named A-Z, unnamed last
    hiddenCount = all.filter((p) => !p.number).length;
    progressEl.style.width = '100%';
    setStatus('Connected to WhatsApp', 'ok');
    banner(true, `Loaded ${plural(participants.length, 'participant', 'participants')}`);
    const noName = all.filter((p) => !p.name).length;
    summaryEl.innerHTML = `<b>${all.length}</b> members · <b>${participants.length}</b> exported · ` +
      `<b class="${hiddenCount ? 'warn' : ''}">${hiddenCount}</b> hidden · <b class="${noName ? 'warn' : ''}">${noName}</b> no name`;
    summaryEl.title = hiddenText();
    summaryEl.hidden = false;
    setExports(participants.length > 0);
    if (!participants.some((p) => p.name)) banner(false, 'No public names found. Click "Copy debug report" below and send it');
  } catch (e) {
    progressEl.style.width = '0';
    setStatus('Connected to WhatsApp', 'ok');
    banner(false, e.message);
    selectedId = ''; // allow re-choosing the same group to retry
  } finally {
    comboBtn.disabled = false;
    render(true);
  }
}

retryBtn.onclick = connect;

const rows = () => participants.map((p) => [p.number, p.name]);
const fileBase = () => 'whatsapp-' + (groupName.replace(/[\\/:*?"<>|]+/g, '').trim() || 'group');

function save(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  banner(true, `Saved ${plural(participants.length, 'participant', 'participants')} · ${hiddenText()}`);
}

xlsxBtn.onclick = () => save(fileBase() + '.xlsx', buildXlsx([['Number', 'Name'], ...rows()]));
const csvEsc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
csvBtn.onclick = () => save(fileBase() + '.csv', new Blob(['﻿Number,Name\n' +
  rows().map((r) => r.map(csvEsc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
copyBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(rows().map((r) => r.join('\t')).join('\n'));
    banner(true, `Copied ${plural(participants.length, 'participant', 'participants')} · ${hiddenText()}`);
  } catch {
    banner(false, 'Clipboard blocked. Use Excel or CSV instead');
  }
};

// Which WhatsApp library version is active, and whether it self-updates.
chrome.runtime.sendMessage({ type: 'SYNC_LIB' }).catch(() => {});
chrome.storage.local.get('libState').then(({ libState: s }) => {
  if (!s) return;
  const el = $('libInfo');
  el.textContent = s.auto ? `WhatsApp library ${s.version} · auto-updating`
    : s.userScriptsOff ? `WhatsApp library ${s.version} · turn on "Allow User Scripts" to auto-update`
    : `WhatsApp library ${s.version} · up to date`;
  el.textContent += ' ·';
  el.classList.toggle('warn', !!s.userScriptsOff);
  el.hidden = false;
});

$('debug').onclick = async () => {
  try {
    const report = await wa('debug', { id: selectedId });
    await navigator.clipboard.writeText('WA exporter debug ' + chrome.runtime.getManifest().version + '\n' + JSON.stringify(report, null, 1));
    banner(true, 'Debug report copied. It has no names or numbers');
  } catch (e) {
    banner(false, 'Debug failed: ' + e.message);
  }
};

connect();

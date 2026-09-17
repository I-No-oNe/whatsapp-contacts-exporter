// Keeps wa-js current from npm so the extension survives WhatsApp Web changes.
// Falls back to the bundled copy in lib/.

const WA = 'https://web.whatsapp.com/*';
const REGISTRY = 'https://registry.npmjs.org/@wppconnect/wa-js';
// Ignore releases newer than this so a bad publish can be pulled first.
const COOL_OFF_MS = 3 * 24 * 60 * 60 * 1000;

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

async function bundledVersion() {
  return (await (await fetch(chrome.runtime.getURL('lib/WA_JS_VERSION'))).text()).trim();
}

// chrome.userScripts throws unless the user enabled "Allow User Scripts"
// (Chrome 138+) or Developer mode (older Chrome).
function userScriptsOn() {
  try { chrome.userScripts.getScripts(); return true; } catch { return false; }
}

// Register wa-js for WhatsApp tabs: downloaded copy if newer and allowed, else bundled.
async function install() {
  const { waJs } = await chrome.storage.local.get('waJs');
  const bundled = await bundledVersion();
  await chrome.scripting.unregisterContentScripts({ ids: ['wa-js'] }).catch(() => {});
  if (userScriptsOn()) await chrome.userScripts.unregister({ ids: ['wa-js'] }).catch(() => {});

  if (waJs && cmp(waJs.version, bundled) > 0 && userScriptsOn()) {
    await chrome.userScripts.register([{
      id: 'wa-js', matches: [WA], world: 'MAIN', runAt: 'document_idle',
      js: [{ file: 'wpp-config.js' }, { code: waJs.code }],
    }]);
    await chrome.storage.local.set({ libState: { version: waJs.version, auto: true } });
  } else {
    await chrome.scripting.registerContentScripts([{
      id: 'wa-js', matches: [WA], world: 'MAIN', runAt: 'document_idle',
      js: ['wpp-config.js', 'lib/wppconnect-wa.js'],
    }]);
    await chrome.storage.local.set({ libState: { version: bundled, auto: false, userScriptsOff: !userScriptsOn() } });
  }
}

// Minimal tar reader: return the text of one file from an uncompressed tarball.
function untar(tar, wanted) {
  const dec = new TextDecoder();
  const str = (a, b) => dec.decode(tar.subarray(a, b)).replace(/\0.*$/s, '');
  for (let off = 0; off + 512 <= tar.length;) {
    const name = str(off, off + 100);
    if (!name) break;
    const prefix = str(off + 345, off + 500);
    const size = parseInt(str(off + 124, off + 136).trim(), 8) || 0;
    if ((prefix ? prefix + '/' : '') + name === wanted) return dec.decode(tar.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} not in tarball`);
}

async function update() {
  const meta = await (await fetch(REGISTRY)).json();
  const version = meta['dist-tags'].latest;
  if (Date.now() - Date.parse(meta.time[version]) < COOL_OFF_MS) return;
  const { waJs } = await chrome.storage.local.get('waJs');
  if (cmp(version, waJs?.version || await bundledVersion()) <= 0) return;

  const { tarball, integrity } = meta.versions[version].dist;
  const gz = new Uint8Array(await (await fetch(tarball)).arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', gz));
  if ('sha512-' + btoa(String.fromCharCode(...digest)) !== integrity) throw new Error('wa-js integrity check failed');
  const tar = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const code = untar(tar, 'package/dist/wppconnect-wa.js');

  await chrome.storage.local.set({ waJs: { version, code } });
  await install();
}

async function sync() {
  await install();
  await update().catch((e) => console.warn('wa-js update skipped:', e));
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.alarms.create('wa-js-update', { periodInMinutes: 12 * 60 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'wa-js-update' && sync());
chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'SYNC_LIB') sync(); });

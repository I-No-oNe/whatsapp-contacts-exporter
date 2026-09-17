// Passes popup requests to main.js in the page context.
(() => {
  // After an extension reload the old listeners are dead but the window flag stays,
  // so only skip if the old copy still answers.
  if (window.__waExporterAlive?.()) return;
  window.__waExporterAlive = () => { try { return !!chrome.runtime.id; } catch { return false; } };

  let seq = 0;
  function ask(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq + '-' + Date.now();
      const done = (fn, v) => { window.removeEventListener('message', onMsg); clearTimeout(t); fn(v); };
      const onMsg = (e) => {
        if (e.source !== window || e.data?.type !== 'WA_EXPORTER_RES' || e.data.id !== id) return;
        if (e.data.error) done(reject, new Error(e.data.error));
        else done(resolve, e.data.result);
      };
      const t = setTimeout(() => done(reject, new Error('No answer from WhatsApp. Reload the tab and try again')), 30000);
      window.addEventListener('message', onMsg);
      window.postMessage({ type: 'WA_EXPORTER_REQ', id, op, args }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type !== 'WA') return;
    ask(msg.op, msg.args).then((result) => send({ ok: true, result }), (e) => send({ ok: false, error: e.message }));
    return true;
  });
})();

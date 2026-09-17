// Runs in the page context and reads WhatsApp through window.WPP (@wppconnect/wa-js).

(() => {
  if (window.__waExporterMain) return;
  window.__waExporterMain = true;

  function ready() {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function wait() {
        if (window.WPP?.isReady) return resolve(window.WPP);
        if (Date.now() - t0 > 20000) {
          return reject(new Error(window.WPP ? 'WhatsApp is not ready. Log in, wait for chats to load and try again'
            : 'WhatsApp library not loaded. Reload the WhatsApp tab'));
        }
        setTimeout(wait, 250);
      })();
    });
  }

  // WhatsApp's own browser database keeps contacts not currently loaded in memory.
  function storedPushnames() {
    return new Promise((resolve) => {
      const names = new Map();
      let req;
      try { req = indexedDB.open('model-storage'); } catch { return resolve(names); }
      req.onerror = () => resolve(names);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('contact')) { db.close(); return resolve(names); }
        const all = db.transaction('contact', 'readonly').objectStore('contact').getAll();
        all.onsuccess = () => {
          for (const c of all.result) {
            const n = c.pushname || c.notifyName || c.verifiedName;
            if (c.id && n) names.set(String(c.id), n);
          }
          db.close();
          resolve(names);
        };
        all.onerror = () => { db.close(); resolve(names); };
      };
    });
  }

  const key = (w) => w?._serialized || String(w || '');
  const tryGet = (fn) => { try { return fn(); } catch { return undefined; } };

  // Every group message carries its sender's public name, even for strangers.
  function msgNames(ChatStore, id) {
    const names = new Map();
    for (const m of ChatStore.get(id)?.msgs?.getModelsArray?.() ?? []) {
      if (m.notifyName && m.author) names.set(key(m.author), m.notifyName);
    }
    return names;
  }

  // Phone digits from any shape WhatsApp uses: Wid object, "15551234567@c.us", "+1 555-123-4567".
  function digits(v) {
    if (!v) return '';
    if (typeof v === 'object') v = v.user || v._serialized || v.id?.user || '';
    const s = String(v);
    if (/@(lid|g\.us|broadcast|newsletter)/.test(s)) return '';
    const raw = s.replace(/@.*$/, '').trim();
    if (!/^\+?[\d\s\-().]+$/.test(raw)) return ''; // a name like "Room 1015555" is not a number
    const d = raw.replace(/\D/g, '');
    return d.length >= 7 && d.length <= 15 ? d : '';
  }

  // Local number lookups for @lid members.
  function lidNumber(WPP, lid, contacts) {
    const { lidPnCache, functions } = WPP.whatsapp;
    const sources = [
      ['getPhoneNumber', () => functions.getPhoneNumber(lid)],
      ['lidPnCache', () => lidPnCache.getPhoneNumber(lid)],
      ...contacts.flatMap((c) => [
        ['contact.phoneNumber', () => c.phoneNumber],
        ['getPnForLid', () => functions.getPnForLid(c)],
        ['contact.pnForLid', () => c.pnForLid],
        ['getFormattedPhone', () => functions.getFormattedPhone(c)],
        ['contact.formattedPhone', () => c.formattedPhone],
        ['getDisplayNameOrPnForLid', () => functions.getDisplayNameOrPnForLid(c)],
      ]),
    ];
    for (const [name, get] of sources) {
      const d = digits(tryGet(get));
      if (d) return [d, name];
    }
    return ['', ''];
  }

  // The name each user set for themselves, not your saved contact name.
  function resolve(WPP, p, stored, fromMsgs) {
    const { ContactStore, lidPnCache, functions } = WPP.whatsapp;
    const isLid = p.id.server === 'lid';
    const contacts = [ContactStore.get(p.id), p.contact].filter(Boolean);
    const [num, numSource] = isLid ? lidNumber(WPP, p.id, contacts) : [digits(p.id), 'c.us'];
    const lid = isLid ? p.id : tryGet(() => lidPnCache.getCurrentLid(p.id));
    const pnWid = num ? { user: num, server: 'c.us', _serialized: num + '@c.us' } : undefined;
    for (const w of [lid, pnWid]) {
      const c = w && w !== p.id && tryGet(() => ContactStore.get(w));
      if (c) contacts.push(c);
    }
    const ids = [p.id, lid, pnWid].filter(Boolean);
    const name =
      contacts.map((c) => tryGet(() => functions.getNotifyName(c)) || c.pushname || c.verifiedName).find(Boolean) ||
      ids.map((w) => fromMsgs.get(key(w)) || stored.get(key(w))).find(Boolean) || '';
    return { number: num, numSource, name };
  }

  // Ask WhatsApp for @lid numbers we couldn't find locally. WhatsApp stores the
  // mapping, so the local lookups above pick it up afterwards.
  async function fetchLidNumbers(WPP, lids) {
    const q = WPP.whatsapp.functions.queryWidExists;
    if (typeof q !== 'function') return;
    const queue = [...lids];
    const worker = async () => {
      while (queue.length) await q(queue.shift()).catch(() => null);
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker)); // 4 at a time
  }

  const ops = {
    async groups(WPP) {
      return WPP.whatsapp.ChatStore.getModelsArray()
        .filter((c) => c.isGroup)
        .map((c) => ({
          id: c.id._serialized,
          name: c.formattedTitle || c.name || c.groupMetadata?.subject || c.id.user,
          size: c.groupMetadata?.participants?.length || 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async participants(WPP, { id }) {
      const { ChatStore } = WPP.whatsapp;
      const stored = await storedPushnames();
      const run = async () => (await WPP.group.getParticipants(id)).map((p) => resolve(WPP, p, stored, msgNames(ChatStore, id)));
      const list = await WPP.group.getParticipants(id);
      const missing = list.filter((p) => p.id.server === 'lid' && !resolve(WPP, p, stored, new Map()).number).map((p) => p.id);
      if (missing.length) await fetchLidNumbers(WPP, missing);
      const rows = await run();
      return rows.map((r) => ({ number: r.number ? '+' + r.number : '', name: r.name }));
    },

    // Counts and field names only, no names or numbers.
    async debug(WPP, { id }) {
      const { ChatStore, ContactStore, lidPnCache, functions } = WPP.whatsapp;
      const stored = await storedPushnames();
      const fromMsgs = msgNames(ChatStore, id);
      const list = id ? await WPP.group.getParticipants(id) : [];
      const n = (f) => list.filter((p) => { try { return !!f(p); } catch { return false; } }).length;
      const contactOf = (p) => ContactStore.get(p.id) || p.contact;
      const sample = list.map(contactOf).find(Boolean);
      const db = await new Promise((res) => {
        try {
          const r = indexedDB.open('model-storage');
          r.onerror = () => res({ error: 'open failed' });
          r.onsuccess = () => { try {
            const d = r.result, stores = [...d.objectStoreNames];
            if (!stores.includes('contact')) { d.close(); return res({ stores }); }
            const g = d.transaction('contact', 'readonly').objectStore('contact').getAll();
            g.onsuccess = () => { d.close(); res({ stores, contactRows: g.result.length, contactKeys: Object.keys(g.result[0] || {}) }); };
            g.onerror = () => { d.close(); res({ stores }); };
          } catch (e) { res({ error: String(e) }); } };
        } catch (e) { res({ error: String(e) }); }
      });
      return {
        wa: window.Debug?.VERSION, wajs: WPP.version, group: !!id,
        total: list.length,
        servers: list.reduce((o, p) => ((o[p.id?.server] = (o[p.id?.server] || 0) + 1), o), {}),
        inContactStore: n((p) => ContactStore.get(p.id)),
        participantContact: n((p) => p.contact),
        notifyName: n((p) => functions.getNotifyName(contactOf(p))),
        pushnameField: n((p) => contactOf(p)?.pushname),
        lidToPnCache: n((p) => p.id.server === 'lid' && lidPnCache.getPhoneNumber(p.id)),
        pnForLidGetter: n((p) => p.id.server === 'lid' && functions.getPnForLid(contactOf(p))),
        msgsLoaded: ChatStore.get(id)?.msgs?.length ?? null, msgNames: fromMsgs.size, storedNames: stored.size,
        resolvedName: n((p) => resolve(WPP, p, stored, fromMsgs).name),
        resolvedNumber: n((p) => resolve(WPP, p, stored, fromMsgs).number),
        numberSources: list.reduce((o, p) => { const k = resolve(WPP, p, stored, fromMsgs).numSource || 'none'; o[k] = (o[k] || 0) + 1; return o; }, {}),
        nativeQueryWidExists: typeof functions.queryWidExists === 'function',
        lidContactFields: (() => { const p = list.find((x) => x.id.server === 'lid'); const c = p && (ContactStore.get(p.id) || p.contact); return c ? Object.keys(c.attributes || c).slice(0, 80) : []; })(),
        contactFields: sample ? Object.keys(sample.attributes || sample).slice(0, 80) : [],
        db,
      };
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.type !== 'WA_EXPORTER_REQ') return;
    const { id, op, args } = e.data;
    let res;
    try { res = { result: await ops[op](await ready(), args) }; } catch (err) { res = { error: String(err?.message || err) }; }
    window.postMessage({ type: 'WA_EXPORTER_RES', id, ...res }, '*');
  });
})();

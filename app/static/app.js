(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const state = {
    token: localStorage.getItem('sv_token'),
    me: null,
    channels: [],
    dms: [],
    users: [],
    online: new Set(),
    active: null,
    messages: new Map(),   // channelId -> [message]
    hasMore: new Set(),    // channelIds with older history on the server
    unread: new Map(),     // channelId -> count
    typing: new Map(),     // channelId -> Map(userId -> {name, timer})
    ws: null,
    retry: 0,
    wasDown: false,
    lastTypingSent: 0,
    authMode: 'login',
  };

  /* ───────────── helpers ───────────── */
  const PALETTE = ['#8c5a3c', '#4f6d7a', '#6b705c', '#9c4f4f', '#5b4b8a', '#3f7d6e', '#a1704a', '#566e8f'];
  const colorFor = (id) => PALETTE[Math.abs(id) % PALETTE.length];
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  function fmtDay(ts) {
    const d = new Date(ts * 1000), today = new Date(), yest = new Date(Date.now() - 864e5);
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yest)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Minimal, XSS-safe formatting: everything is escaped first, then a small set of patterns is re-enabled.
  function fmt(text) {
    const stash = [];
    const keep = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
    let s = text.replace(/```([\s\S]*?)```/g, (_, c) => keep(`<pre><code>${esc(c.replace(/^\n/, '').trimEnd())}</code></pre>`));
    s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\n/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  }

  function toast(msg) {
    const t = el('div', 'toast', msg);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3800);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && state.token && !path.startsWith('/api/login')) {
      signOut(false);
      throw new Error('Your session has expired. Please sign in again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === 'string' ? d : (d && d[0] && d[0].msg) || 'Something went wrong');
    }
    return data;
  }

  const allChannels = () => [...state.channels, ...state.dms];
  const findChannel = (id) => allChannels().find((c) => c.id === id);
  const channelTitle = (c) => (c.kind === 'dm' ? c.peer.display_name : `# ${c.name}`);

  /* ───────────── auth ───────────── */
  function showAuth() {
    $('#app').hidden = true;
    $('#auth').hidden = false;
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    $('#name-row').hidden = mode !== 'register';
    $('#name-row input').required = mode === 'register';
    $('#auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
    $('#auth-form [name=password]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-error').textContent = '';
  }

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    $('#auth-error').textContent = '';
    try {
      const login = state.authMode === 'login';
      const data = await api(login ? '/api/login' : '/api/register', {
        method: 'POST',
        body: login
          ? { username: f.username.trim(), password: f.password }
          : { username: f.username.trim(), display_name: (f.display_name || f.username).trim(), password: f.password },
      });
      state.token = data.token;
      localStorage.setItem('sv_token', data.token);
      state.me = data.user;
      e.target.reset();
      await enter();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    }
  });

  async function signOut(callServer = true) {
    if (callServer && state.token) { try { await api('/api/logout', { method: 'POST' }); } catch (_) { /* ignore */ } }
    localStorage.removeItem('sv_token');
    state.token = null; state.me = null; state.active = null;
    state.messages.clear(); state.unread.clear(); state.hasMore.clear(); state.online.clear();
    if (state.ws) { const w = state.ws; state.ws = null; w.close(); }
    showAuth();
  }
  $('#signout').addEventListener('click', () => signOut(true));

  /* ───────────── workspace bootstrap ───────────── */
  async function loadChannels() {
    const data = await api('/api/channels');
    state.channels = data.channels;
    state.dms = data.dms;
  }

  async function enter() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    const av = $('#me-avatar');
    av.textContent = initials(state.me.display_name);
    av.style.background = colorFor(state.me.id);
    $('#me-name').textContent = state.me.display_name;
    await loadChannels();
    const first = state.channels.find((c) => c.name === 'general') || state.channels[0];
    renderSidebar();
    if (first) await selectChannel(first.id);
    connect();
  }

  /* ───────────── sidebar ───────────── */
  function navItem(c) {
    const li = el('li');
    const b = el('button', 'nav-item' + (c.id === state.active ? ' active' : '') + (state.unread.get(c.id) ? ' unread' : ''));
    b.type = 'button';
    if (c.kind === 'dm') b.append(el('span', 'presence' + (state.online.has(c.peer.id) ? ' on' : '')));
    else b.append(el('span', 'hash', '#'));
    b.append(el('span', 'label', c.kind === 'dm' ? c.peer.display_name : c.name));
    const n = state.unread.get(c.id);
    if (n) b.append(el('span', 'badge', n > 99 ? '99+' : String(n)));
    b.addEventListener('click', () => selectChannel(c.id));
    li.append(b);
    return li;
  }

  function renderSidebar() {
    $('#channel-list').replaceChildren(...state.channels.map(navItem));
    $('#dm-list').replaceChildren(...state.dms.map(navItem));
    const total = [...state.unread.values()].reduce((a, b) => a + b, 0);
    document.title = total ? `(${total}) Strevilatte` : 'Strevilatte';
  }

  /* ───────────── conversations ───────────── */
  async function loadHistory(id, before) {
    const q = `limit=50${before ? `&before=${before}` : ''}`;
    const data = await api(`/api/channels/${id}/messages?${q}`);
    return data;
  }

  async function selectChannel(id) {
    const c = findChannel(id);
    if (!c) return;
    state.active = id;
    state.unread.delete(id);
    $('#chan-title').textContent = channelTitle(c);
    $('#chan-topic').textContent = c.kind === 'dm' ? `Direct message with ${c.peer.display_name}` : c.topic || 'No topic set';
    $('#sidebar').classList.remove('open');
    renderSidebar();
    renderTyping();
    try {
      if (!state.messages.has(id)) {
        const data = await loadHistory(id);
        state.messages.set(id, data.messages);
        if (data.has_more) state.hasMore.add(id); else state.hasMore.delete(id);
      }
    } catch (err) { toast(err.message); }
    if (state.active === id) {
      renderMessages('bottom');
      $('#composer-input').focus();
    }
  }

  async function loadEarlier() {
    const list = state.messages.get(state.active) || [];
    if (!list.length) return;
    try {
      const data = await loadHistory(state.active, list[0].id);
      state.messages.set(state.active, [...data.messages, ...list]);
      if (data.has_more) state.hasMore.add(state.active); else state.hasMore.delete(state.active);
      renderMessages('preserve');
    } catch (err) { toast(err.message); }
  }

  /* ───────────── message rendering ───────────── */
  function renderMessages(mode = 'auto') {
    const box = $('#messages');
    const list = state.messages.get(state.active) || [];
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    box.replaceChildren();

    if (state.hasMore.has(state.active)) {
      const more = el('button', 'load-more', 'Load earlier messages');
      more.type = 'button';
      more.addEventListener('click', loadEarlier);
      box.append(more);
    }

    if (!list.length) {
      const c = findChannel(state.active);
      const empty = el('div', 'empty');
      empty.append(el('strong', null, c ? (c.kind === 'dm' ? `Start a conversation with ${c.peer.display_name}` : `Welcome to ${channelTitle(c)}`) : 'No messages yet'));
      empty.append(el('span', null, 'Be the first to say something.'));
      box.append(empty);
    }

    let prev = null, lastDay = '';
    for (const m of list) {
      const day = new Date(m.created_at * 1000).toDateString();
      if (day !== lastDay) { box.append(el('div', 'divider', fmtDay(m.created_at))); lastDay = day; prev = null; }
      const grouped = !!prev && prev.user_id === m.user_id && m.created_at - prev.created_at < 300;
      box.append(messageEl(m, grouped));
      prev = m;
    }

    if (mode === 'bottom' || (mode === 'auto' && nearBottom)) box.scrollTop = box.scrollHeight;
    else if (mode === 'preserve') box.scrollTop = prevTop + (box.scrollHeight - prevH);
  }

  function messageEl(m, grouped) {
    const row = el('article', 'msg' + (grouped ? ' grouped' : ''));
    row.dataset.id = m.id;

    const gutter = grouped ? el('div', 'hover-time', fmtTime(m.created_at)) : el('div', 'avatar', initials(m.display_name));
    if (!grouped) gutter.style.background = colorFor(m.user_id);
    row.append(gutter);

    const col = el('div');
    if (!grouped) {
      const head = el('div', 'msg-head');
      head.append(el('span', 'msg-name', m.display_name), el('span', 'msg-time', fmtTime(m.created_at)));
      col.append(head);
    }
    const body = el('div', 'msg-body');
    body.innerHTML = fmt(m.body);
    if (m.edited_at) body.append(' ', el('span', 'edited', '(edited)'));
    col.append(body);
    row.append(col);

    if (m.user_id === state.me.id) {
      const bar = el('div', 'actions');
      const edit = el('button', null, 'Edit'); edit.type = 'button';
      const del = el('button', 'del', 'Delete'); del.type = 'button';
      edit.addEventListener('click', () => beginEdit(m, body));
      del.addEventListener('click', () => {
        if (confirm('Delete this message? This cannot be undone.')) send({ type: 'delete', message_id: m.id });
      });
      bar.append(edit, del);
      row.append(bar);
    }
    return row;
  }

  function beginEdit(m, body) {
    const ta = el('textarea', 'edit-box');
    ta.value = m.body; ta.maxLength = 4000;
    const bar = el('div', 'edit-bar');
    const save = el('button', 'btn primary', 'Save'); save.type = 'button';
    const cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button';
    bar.append(save, cancel);
    body.replaceChildren(ta, bar);
    ta.focus();
    const done = () => renderMessages('keep');
    const commit = () => {
      const v = ta.value.trim();
      if (!v) return toast('A message cannot be empty. Use Delete to remove it.');
      if (v !== m.body) send({ type: 'edit', message_id: m.id, body: v });
      done();
    };
    save.addEventListener('click', commit);
    cancel.addEventListener('click', done);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') done();
    });
  }

  /* ───────────── typing indicator ───────────── */
  function renderTyping() {
    const who = [...(state.typing.get(state.active) || new Map()).values()].map((v) => v.name);
    const t = $('#typing');
    if (!who.length) t.textContent = '';
    else if (who.length === 1) t.textContent = `${who[0]} is typing…`;
    else if (who.length === 2) t.textContent = `${who[0]} and ${who[1]} are typing…`;
    else t.textContent = 'Several people are typing…';
  }

  function clearTyping(channelId, userId) {
    const m = state.typing.get(channelId);
    if (!m || !m.has(userId)) return;
    clearTimeout(m.get(userId).timer);
    m.delete(userId);
    if (channelId === state.active) renderTyping();
  }

  function noteTyping(channelId, userId, name) {
    if (!state.typing.has(channelId)) state.typing.set(channelId, new Map());
    const m = state.typing.get(channelId);
    if (m.has(userId)) clearTimeout(m.get(userId).timer);
    m.set(userId, { name, timer: setTimeout(() => clearTyping(channelId, userId), 3500) });
    if (channelId === state.active) renderTyping();
  }

  /* ───────────── realtime ───────────── */
  function send(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) { state.ws.send(JSON.stringify(obj)); return true; }
    toast('Reconnecting… please try again in a moment.');
    return false;
  }

  function setStatus(down) {
    $('#status').hidden = !down;
  }

  function connect() {
    if (!state.token) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    state.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: state.token }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      onEvent(m);
    };
    ws.onclose = (ev) => {
      if (state.ws !== ws) return;           // replaced or signed out
      if (ev.code === 4401) { signOut(false); return; }
      state.wasDown = true;
      setStatus(true);
      state.online.clear();
      renderSidebar();
      const delay = Math.min(15000, 800 * 2 ** state.retry++);
      setTimeout(() => { if (state.ws === ws && state.token) connect(); }, delay);
    };
    setInterval_once();
  }

  let pingTimer = null;
  function setInterval_once() {
    if (pingTimer) return;
    pingTimer = setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'ping' }));
    }, 25000);
  }

  async function resync() {
    try {
      await loadChannels();
      const id = state.active;
      if (id && findChannel(id)) {
        const data = await loadHistory(id);
        state.messages.set(id, data.messages);
        if (data.has_more) state.hasMore.add(id); else state.hasMore.delete(id);
        renderMessages('auto');
      }
      renderSidebar();
    } catch (_) { /* surfaced elsewhere */ }
  }

  function onEvent(m) {
    switch (m.type) {
      case 'ready':
        state.retry = 0;
        state.online = new Set(m.online);
        setStatus(false);
        renderSidebar();
        if (state.wasDown) { state.wasDown = false; resync(); }
        break;
      case 'presence':
        if (m.online) state.online.add(m.user_id); else state.online.delete(m.user_id);
        renderSidebar();
        break;
      case 'message': addMessage(m.message); break;
      case 'message_edited': patchMessage(m.message); break;
      case 'message_deleted': removeMessage(m.channel_id, m.message_id); break;
      case 'typing':
        if (m.user_id !== state.me.id) noteTyping(m.channel_id, m.user_id, m.display_name);
        break;
      case 'channel_created':
        if (!state.channels.some((c) => c.id === m.channel.id)) {
          state.channels.push(m.channel);
          state.channels.sort((a, b) => a.name.localeCompare(b.name));
          renderSidebar();
        }
        break;
      case 'dm_created':
        if (!state.dms.some((c) => c.id === m.channel.id)) {
          state.dms.push(m.channel);
          state.dms.sort((a, b) => a.peer.display_name.localeCompare(b.peer.display_name));
          renderSidebar();
        }
        break;
      case 'error': toast(m.error); break;
      default: break;
    }
  }

  async function addMessage(m) {
    // A DM can arrive just before its dm_created event is processed; make sure we know the conversation.
    if (!findChannel(m.channel_id)) { await loadChannels(); renderSidebar(); }
    const list = state.messages.get(m.channel_id);
    if (list && !list.some((x) => x.id === m.id)) list.push(m);
    clearTyping(m.channel_id, m.user_id);
    if (m.channel_id === state.active) {
      renderMessages(m.user_id === state.me.id ? 'bottom' : 'auto');
    } else if (m.user_id !== state.me.id) {
      state.unread.set(m.channel_id, (state.unread.get(m.channel_id) || 0) + 1);
      renderSidebar();
    }
  }

  function patchMessage(m) {
    const list = state.messages.get(m.channel_id);
    if (!list) return;
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list[i] = m;
    if (m.channel_id === state.active) renderMessages('keep');
  }

  function removeMessage(channelId, messageId) {
    const list = state.messages.get(channelId);
    if (!list) return;
    state.messages.set(channelId, list.filter((x) => x.id !== messageId));
    if (channelId === state.active) renderMessages('keep');
  }

  /* ───────────── composer ───────────── */
  const input = $('#composer-input');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };

  function submit() {
    const body = input.value.trim();
    if (!body || !state.active) return;
    if (send({ type: 'message', channel_id: state.active, body })) { input.value = ''; grow(); }
  }

  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  input.addEventListener('input', () => {
    grow();
    const t = Date.now();
    if (input.value && state.active && t - state.lastTypingSent > 2000 && state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.lastTypingSent = t;
      state.ws.send(JSON.stringify({ type: 'typing', channel_id: state.active }));
    }
  });

  /* ───────────── dialogs ───────────── */
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  $('#add-channel').addEventListener('click', () => {
    $('#channel-error').textContent = '';
    $('#channel-form').reset();
    $('#channel-dialog').showModal();
  });

  $('#channel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const { channel } = await api('/api/channels', { method: 'POST', body: { name: f.name, topic: f.topic || '' } });
      if (!state.channels.some((c) => c.id === channel.id)) {
        state.channels.push(channel);
        state.channels.sort((a, b) => a.name.localeCompare(b.name));
      }
      $('#channel-dialog').close();
      await selectChannel(channel.id);
    } catch (err) { $('#channel-error').textContent = err.message; }
  });

  function renderUserPicker() {
    const q = $('#dm-filter').value.trim().toLowerCase();
    const list = $('#dm-users');
    const people = state.users.filter((u) => u.id !== state.me.id &&
      (u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)));
    if (!people.length) { list.replaceChildren(el('li', 'pick-empty', 'No teammates found')); return; }
    list.replaceChildren(...people.map((u) => {
      const li = el('li'), b = el('button'); b.type = 'button';
      const av = el('div', 'avatar sm', initials(u.display_name)); av.style.background = colorFor(u.id);
      const main = el('div', 'pick-main');
      main.append(el('div', null, u.display_name), el('div', 'pick-sub', '@' + u.username));
      b.append(av, main, el('span', 'presence' + (state.online.has(u.id) ? ' on' : '')));
      b.addEventListener('click', async () => {
        try {
          const { channel } = await api('/api/dm', { method: 'POST', body: { user_id: u.id } });
          if (!state.dms.some((c) => c.id === channel.id)) {
            state.dms.push(channel);
            state.dms.sort((a, b2) => a.peer.display_name.localeCompare(b2.peer.display_name));
          }
          $('#dm-dialog').close();
          await selectChannel(channel.id);
        } catch (err) { toast(err.message); }
      });
      li.append(b);
      return li;
    }));
  }

  $('#add-dm').addEventListener('click', async () => {
    $('#dm-filter').value = '';
    try { state.users = (await api('/api/users')).users; } catch (err) { return toast(err.message); }
    renderUserPicker();
    $('#dm-dialog').showModal();
    $('#dm-filter').focus();
  });
  $('#dm-filter').addEventListener('input', renderUserPicker);

  /* ───────────── search ───────────── */
  $('#search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (q.length < 2) return toast('Type at least 2 characters to search.');
    try {
      const { results } = await api('/api/search?q=' + encodeURIComponent(q));
      $('#search-title').textContent = `${results.length} result${results.length === 1 ? '' : 's'} for “${q}”`;
      const list = $('#search-results');
      if (!results.length) list.replaceChildren(el('li', 'pick-empty', 'No messages matched your search.'));
      else list.replaceChildren(...results.map((m) => {
        const c = findChannel(m.channel_id);
        const li = el('li'), b = el('button'); b.type = 'button';
        const main = el('div', 'pick-main');
        main.append(
          el('div', 'pick-sub', `${c ? channelTitle(c) : 'Conversation'} · ${m.display_name} · ${fmtDay(m.created_at)}, ${fmtTime(m.created_at)}`),
          el('div', 'pick-snippet', m.body.replace(/\s+/g, ' ').slice(0, 160)),
        );
        b.append(main);
        b.addEventListener('click', () => { $('#search-dialog').close(); if (c) selectChannel(c.id); });
        li.append(b);
        return li;
      }));
      $('#search-dialog').showModal();
    } catch (err) { toast(err.message); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search-input').focus(); }
  });

  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('.main').addEventListener('click', () => $('#sidebar').classList.remove('open'));

  /* ───────────── boot ───────────── */
  (async function boot() {
    setAuthMode('login');
    if (!state.token) return showAuth();
    try {
      state.me = (await api('/api/me')).user;
      await enter();
    } catch (_) { showAuth(); }
  })();
})();

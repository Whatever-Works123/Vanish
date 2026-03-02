diff --git a/public/app.js b/public/app.js
new file mode 100644
index 0000000000000000000000000000000000000000..2b31812c7b5e3b52a79c86aa826dfa28a0006d14
--- /dev/null
+++ b/public/app.js
@@ -0,0 +1,170 @@
+const state = {
+  token: localStorage.getItem('token') || null,
+  me: null,
+  chats: [],
+  messages: [],
+  stories: [],
+  activeChat: 'general',
+  currentCapture: null,
+  typingUsers: new Set()
+};
+
+const $ = (id) => document.getElementById(id);
+
+async function api(path, options = {}) {
+  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
+  if (state.token) headers.Authorization = `Bearer ${state.token}`;
+  const res = await fetch(path, { ...options, headers });
+  const body = await res.json().catch(() => ({}));
+  if (!res.ok) throw new Error(body.error || 'Request failed');
+  return body;
+}
+
+function render() {
+  $('chatTitle').textContent = `Chat • ${state.activeChat}`;
+  $('chatList').innerHTML = state.chats.map((c) => `<div class="chat-item ${c.id === state.activeChat ? 'active' : ''}" data-id="${c.id}">${c.name}</div>`).join('');
+  $('chatList').querySelectorAll('.chat-item').forEach((el) => el.onclick = () => { state.activeChat = el.dataset.id; render(); });
+
+  const now = Date.now();
+  const messages = state.messages.filter((m) => m.chatId === state.activeChat);
+  $('messages').innerHTML = messages.map((m) => {
+    const seconds = Math.max(0, Math.round((m.expiresAt - now) / 1000));
+    const media = m.mediaDataUrl ? `<img src="${m.mediaDataUrl}" style="width:100%;max-height:210px;object-fit:cover;border-radius:10px;border:1px solid #2d3a63;" />` : '';
+    return `<div class="message ${m.from === state.me ? 'mine' : ''}" data-id="${m.id}">
+      <b>${m.from}</b> ${m.type === 'media' ? '📸' : ''}
+      <div>${m.text || ''}</div>
+      ${media}
+      <small>⏱ ${seconds}s • read by ${m.viewedBy.length}</small>
+    </div>`;
+  }).join('');
+
+  $('messages').querySelectorAll('.message').forEach((msg) => {
+    msg.onclick = async () => {
+      try { await api('/api/message/view', { method: 'POST', body: JSON.stringify({ id: msg.dataset.id }) }); } catch {}
+    };
+  });
+
+  $('stories').innerHTML = state.stories.map((s) => `<div class="story"><b>${s.author}</b><br /><small>${s.caption || 'story'} • ${s.circle}</small></div>`).join('');
+  $('typingIndicator').textContent = state.typingUsers.size ? `${[...state.typingUsers].join(', ')} typing...` : '';
+}
+
+async function loadState() {
+  const data = await api('/api/state');
+  state.me = data.me;
+  state.chats = data.chats;
+  state.messages = data.messages;
+  state.stories = data.stories;
+  render();
+}
+
+async function setupCamera() {
+  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
+  $('video').srcObject = stream;
+}
+
+function captureFrame() {
+  const video = $('video');
+  const canvas = $('captureCanvas');
+  canvas.width = video.videoWidth || 720;
+  canvas.height = video.videoHeight || 960;
+  const ctx = canvas.getContext('2d');
+  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
+  state.currentCapture = canvas.toDataURL('image/jpeg', 0.85);
+}
+
+function subscribeEvents() {
+  const events = new EventSource('/events');
+  events.onmessage = (e) => {
+    const event = JSON.parse(e.data);
+    if (event.type === 'message:new') state.messages.push(event.data);
+    if (event.type === 'message:deleted') state.messages = state.messages.filter((m) => m.id !== event.data.id);
+    if (event.type === 'message:viewed') {
+      const msg = state.messages.find((m) => m.id === event.data.id);
+      if (msg && !msg.viewedBy.includes(event.data.username)) msg.viewedBy.push(event.data.username);
+    }
+    if (event.type === 'messages:expired') state.messages = state.messages.filter((m) => m.expiresAt > Date.now());
+    if (event.type === 'story:new') state.stories.push(event.data);
+    if (event.type === 'stories:expired') state.stories = state.stories.filter((s) => s.expiresAt > Date.now());
+    if (event.type === 'typing') {
+      if (event.data.chatId === state.activeChat && event.data.username !== state.me) {
+        if (event.data.typing) state.typingUsers.add(event.data.username);
+        else state.typingUsers.delete(event.data.username);
+      }
+    }
+    if (event.type === 'reaction') $('presence').textContent = `${event.data.from} reacted ${event.data.emoji} in ${event.data.chatId}`;
+    if (event.type === 'privacy:alert') $('presence').textContent = `⚠️ ${event.data.from}: ${event.data.reason}`;
+    render();
+  };
+}
+
+function bindUI() {
+  $('registerBtn').onclick = async () => {
+    try {
+      await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
+      $('authStatus').textContent = 'Account created. Log in to continue.';
+    } catch (e) { $('authStatus').textContent = e.message; }
+  };
+
+  $('loginBtn').onclick = async () => {
+    try {
+      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
+      state.token = data.token;
+      localStorage.setItem('token', data.token);
+      $('auth').classList.add('hidden');
+      $('app').classList.remove('hidden');
+      await loadState();
+      subscribeEvents();
+    } catch (e) { $('authStatus').textContent = e.message; }
+  };
+
+  $('startCamera').onclick = setupCamera;
+  $('capture').onclick = captureFrame;
+
+  $('sendStory').onclick = async () => {
+    if (!state.currentCapture) return;
+    await api('/api/story', { method: 'POST', body: JSON.stringify({ mediaDataUrl: state.currentCapture, caption: 'Vanish story', circle: 'close-friends' }) });
+  };
+
+  $('sendMessage').onclick = async () => {
+    const type = $('messageType').value;
+    await api('/api/message', {
+      method: 'POST',
+      body: JSON.stringify({
+        chatId: state.activeChat,
+        type,
+        text: $('messageInput').value,
+        ttl: Number($('ttl').value),
+        deleteAfterView: $('deleteAfterView').checked,
+        mediaDataUrl: type === 'media' ? state.currentCapture : null
+      })
+    });
+    $('messageInput').value = '';
+    await api('/api/typing', { method: 'POST', body: JSON.stringify({ chatId: state.activeChat, typing: false }) });
+  };
+
+  $('messageInput').oninput = async () => {
+    await api('/api/typing', { method: 'POST', body: JSON.stringify({ chatId: state.activeChat, typing: true }) });
+    clearTimeout(window.__typingTimer);
+    window.__typingTimer = setTimeout(() => api('/api/typing', { method: 'POST', body: JSON.stringify({ chatId: state.activeChat, typing: false }) }), 900);
+  };
+
+  document.querySelectorAll('.emoji').forEach((btn) => {
+    btn.onclick = async () => api('/api/reaction', { method: 'POST', body: JSON.stringify({ chatId: state.activeChat, emoji: btn.dataset.emoji }) });
+  });
+
+  $('privacyAlert').onclick = async () => api('/api/privacy-alert', { method: 'POST', body: JSON.stringify({ chatId: state.activeChat, reason: 'Screenshot/screen-record attempt detected' }) });
+}
+
+bindUI();
+if (state.token) {
+  $('auth').classList.add('hidden');
+  $('app').classList.remove('hidden');
+  loadState().then(() => subscribeEvents()).catch(() => {
+    state.token = null;
+    localStorage.removeItem('token');
+    $('auth').classList.remove('hidden');
+    $('app').classList.add('hidden');
+  });
+}
+
+setInterval(render, 1000);

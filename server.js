diff --git a/server.js b/server.js
new file mode 100644
index 0000000000000000000000000000000000000000..fb63cab0b1736401ffabe61fee7b233529922028
--- /dev/null
+++ b/server.js
@@ -0,0 +1,219 @@
+const http = require('http');
+const fs = require('fs');
+const path = require('path');
+const crypto = require('crypto');
+const { URL } = require('url');
+
+const PORT = process.env.PORT || 3000;
+const PUBLIC_DIR = path.join(__dirname, 'public');
+
+const db = {
+  users: new Map(),
+  sessions: new Map(),
+  chats: new Map([["general", { id: "general", name: "General", group: true }], ["close-friends", { id: "close-friends", name: "Close Friends", group: true }]]),
+  messages: [],
+  stories: [],
+  events: []
+};
+
+const sseClients = new Set();
+
+function json(res, code, payload) {
+  res.writeHead(code, { 'Content-Type': 'application/json' });
+  res.end(JSON.stringify(payload));
+}
+
+function parseBody(req) {
+  return new Promise((resolve) => {
+    let raw = '';
+    req.on('data', (chunk) => (raw += chunk));
+    req.on('end', () => {
+      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
+    });
+  });
+}
+
+function auth(req) {
+  const token = req.headers.authorization?.replace('Bearer ', '');
+  return token && db.sessions.has(token) ? db.sessions.get(token) : null;
+}
+
+function publish(type, data) {
+  const event = { id: crypto.randomUUID(), type, data, ts: Date.now() };
+  db.events.push(event);
+  if (db.events.length > 500) db.events.shift();
+  for (const client of sseClients) {
+    client.write(`data: ${JSON.stringify(event)}\n\n`);
+  }
+}
+
+function cleanupExpiringData() {
+  const now = Date.now();
+  const beforeMessages = db.messages.length;
+  db.messages = db.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
+  if (db.messages.length !== beforeMessages) publish('messages:expired', { now });
+
+  const beforeStories = db.stories.length;
+  db.stories = db.stories.filter((s) => s.expiresAt > now);
+  if (db.stories.length !== beforeStories) publish('stories:expired', { now });
+}
+
+setInterval(cleanupExpiringData, 15000);
+
+function serveStatic(req, res) {
+  const requestPath = req.url === '/' ? '/index.html' : req.url;
+  const filePath = path.join(PUBLIC_DIR, requestPath);
+  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });
+  fs.readFile(filePath, (err, content) => {
+    if (err) return json(res, 404, { error: 'Not found' });
+    const ext = path.extname(filePath);
+    const typeMap = {
+      '.html': 'text/html',
+      '.js': 'application/javascript',
+      '.css': 'text/css',
+      '.json': 'application/json',
+      '.png': 'image/png',
+      '.jpg': 'image/jpeg',
+      '.svg': 'image/svg+xml'
+    };
+    res.writeHead(200, { 'Content-Type': typeMap[ext] || 'application/octet-stream' });
+    res.end(content);
+  });
+}
+
+const server = http.createServer(async (req, res) => {
+  const parsed = new URL(req.url, `http://${req.headers.host}`);
+
+  if (parsed.pathname === '/events' && req.method === 'GET') {
+    res.writeHead(200, {
+      'Content-Type': 'text/event-stream',
+      'Cache-Control': 'no-cache',
+      Connection: 'keep-alive',
+      'Access-Control-Allow-Origin': '*'
+    });
+    res.write('\n');
+    sseClients.add(res);
+    req.on('close', () => sseClients.delete(res));
+    return;
+  }
+
+  if (parsed.pathname === '/api/register' && req.method === 'POST') {
+    const body = await parseBody(req);
+    if (!body.username || !body.password) return json(res, 400, { error: 'Missing credentials' });
+    if (db.users.has(body.username)) return json(res, 409, { error: 'User exists' });
+    db.users.set(body.username, { username: body.username, password: body.password, closeFriends: [] });
+    return json(res, 201, { ok: true });
+  }
+
+  if (parsed.pathname === '/api/login' && req.method === 'POST') {
+    const body = await parseBody(req);
+    const user = db.users.get(body.username);
+    if (!user || user.password !== body.password) return json(res, 401, { error: 'Invalid credentials' });
+    const token = crypto.randomUUID();
+    db.sessions.set(token, user.username);
+    return json(res, 200, { token, username: user.username });
+  }
+
+  if (parsed.pathname === '/api/state' && req.method === 'GET') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    cleanupExpiringData();
+    return json(res, 200, {
+      me: username,
+      chats: [...db.chats.values()],
+      messages: db.messages,
+      stories: db.stories,
+      users: [...db.users.keys()]
+    });
+  }
+
+  if (parsed.pathname === '/api/message' && req.method === 'POST') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    const body = await parseBody(req);
+    const ttl = Number(body.ttl || 30);
+    const message = {
+      id: crypto.randomUUID(),
+      chatId: body.chatId || 'general',
+      from: username,
+      type: body.type || 'text',
+      text: body.text || '',
+      mediaDataUrl: body.mediaDataUrl || null,
+      viewedBy: [],
+      createdAt: Date.now(),
+      expiresAt: Date.now() + ttl * 1000,
+      deleteAfterView: Boolean(body.deleteAfterView)
+    };
+    db.messages.push(message);
+    publish('message:new', message);
+    return json(res, 201, { ok: true, message });
+  }
+
+  if (parsed.pathname === '/api/message/view' && req.method === 'POST') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    const body = await parseBody(req);
+    const message = db.messages.find((m) => m.id === body.id);
+    if (!message) return json(res, 404, { error: 'Not found' });
+    if (!message.viewedBy.includes(username)) message.viewedBy.push(username);
+    if (message.deleteAfterView && message.from !== username) {
+      db.messages = db.messages.filter((m) => m.id !== message.id);
+      publish('message:deleted', { id: message.id, reason: 'viewed' });
+    } else {
+      publish('message:viewed', { id: message.id, username });
+    }
+    return json(res, 200, { ok: true });
+  }
+
+  if (parsed.pathname === '/api/story' && req.method === 'POST') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    const body = await parseBody(req);
+    const story = {
+      id: crypto.randomUUID(),
+      author: username,
+      mediaDataUrl: body.mediaDataUrl,
+      caption: body.caption || '',
+      circle: body.circle || 'public',
+      createdAt: Date.now(),
+      expiresAt: Date.now() + 24 * 60 * 60 * 1000
+    };
+    db.stories.push(story);
+    publish('story:new', story);
+    return json(res, 201, { ok: true, story });
+  }
+
+
+
+  if (parsed.pathname === '/api/reaction' && req.method === 'POST') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    const body = await parseBody(req);
+    publish('reaction', { chatId: body.chatId, from: username, emoji: body.emoji });
+    return json(res, 200, { ok: true });
+  }
+
+  if (parsed.pathname === '/api/typing' && req.method === 'POST') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    const body = await parseBody(req);
+    publish('typing', { chatId: body.chatId, username, typing: Boolean(body.typing) });
+    return json(res, 200, { ok: true });
+  }
+
+  if (parsed.pathname === '/api/privacy-alert' && req.method === 'POST') {
+    const username = auth(req);
+    if (!username) return json(res, 401, { error: 'Unauthorized' });
+    const body = await parseBody(req);
+    publish('privacy:alert', { from: username, chatId: body.chatId, reason: body.reason });
+    return json(res, 200, { ok: true });
+  }
+
+  if (req.method === 'GET') return serveStatic(req, res);
+
+  json(res, 404, { error: 'Route not found' });
+});
+
+server.listen(PORT, () => {
+  console.log(`Vanish running on http://localhost:${PORT}`);
+});

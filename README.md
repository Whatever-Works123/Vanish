#Vanish
diff --git a/README.md b/README.md
index 6a390ee8d48bd36bd5fb36c72f0b19f707b8647c..819877fa80994d589fdc3f1d0fa723ad13faf8fb 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,33 @@
-# Vanish
\ No newline at end of file
+# Vanish
+
+Vanish is a modern, privacy-focused real-time web app prototype for disappearing communication.
+
+## Highlights
+
+- **Secure auth flow + profiles** (username/password demo auth with session tokens)
+- **Real-time chat** over Server-Sent Events with:
+  - private/group-style channels
+  - typing indicators
+  - read receipts
+  - emoji reactions
+- **Disappearing content**:
+  - TTL-based disappearing messages
+  - delete-after-view behavior
+  - stories that auto-expire after 24 hours
+- **Camera-first capture** from browser camera for disappearing photo messages/stories
+- **Privacy UX**:
+  - privacy alerts for screenshot/screen-record style events (manual trigger)
+
+## Tech
+
+- Zero external runtime dependencies (works without package install)
+- Node.js HTTP server + SSE broadcast model
+- Vanilla HTML/CSS/JS for fast mobile-first UI
+
+## Run
+
+```bash
+node server.js
+```
+
+Open `http://localhost:3000`.

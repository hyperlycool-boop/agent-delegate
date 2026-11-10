---
description: Open the delegation dashboard (jobs, live output, model and effort) in a browser
argument-hint: "[port]"
---

Start the dashboard server from the repo root in the background: `node ${CLAUDE_PLUGIN_ROOT}/dashboard/server.js --port ${ARGUMENTS:-4319}`. It listens on 127.0.0.1 only. When it prints its URL, give the user that URL in one line (open it in the browser pane if one is available). Do not stop it unless the user asks.

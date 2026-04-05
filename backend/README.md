# Fedya Galaxy Explorer — Multiplayer Backend

Two backend options are provided. Pick one and follow its setup section.

| | Python server | Cloudflare Worker |
|---|---|---|
| **Cost** | VPS/free tier required | Free tier available |
| **Latency** | Depends on server location | Cloudflare edge, low latency |
| **Complexity** | Simple, run anywhere | Requires Cloudflare account |
| **Persistent leaderboard** | `leaderboard.json` on disk | Workers KV |

---

## Option A — Python asyncio server

### Requirements

- Python 3.11+
- A VPS, a cloud VM, or any machine reachable from the internet (or just localhost for local testing)

### Quick start

```bash
# 1. Create a virtual environment
cd /path/to/fedya-site/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install websockets

# 3. Run
python server.py --host 0.0.0.0 --port 8765
```

The server logs to stdout. `leaderboard.json` is written in the same directory.

### Running as a systemd service (Linux VPS)

Create `/etc/systemd/system/galaxy-mp.service`:

```ini
[Unit]
Description=Fedya Galaxy Explorer Multiplayer Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/fedya-site/backend
ExecStart=/var/www/fedya-site/backend/.venv/bin/python server.py --host 127.0.0.1 --port 8765
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable galaxy-mp
sudo systemctl start galaxy-mp
sudo journalctl -u galaxy-mp -f   # follow logs
```

### nginx WebSocket proxy

Add to your nginx server block:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    # ... your existing SSL config ...

    # WebSocket multiplayer proxy
    location /ws {
        proxy_pass          http://127.0.0.1:8765;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade    $http_upgrade;
        proxy_set_header    Connection "upgrade";
        proxy_set_header    Host       $host;
        proxy_set_header    X-Real-IP  $remote_addr;
        proxy_read_timeout  3600s;    # keep WS connections open
        proxy_send_timeout  3600s;
    }

    # Static site
    location / {
        root  /var/www/fedya-site;
        index index.html;
    }
}
```

### Caddy WebSocket proxy

In your `Caddyfile`:

```caddyfile
yourdomain.com {
    # WebSocket multiplayer proxy
    handle /ws* {
        reverse_proxy localhost:8765
    }

    # Static site
    handle {
        root * /var/www/fedya-site
        file_server
    }
}
```

Caddy automatically provisions TLS and handles WebSocket upgrades.

### Docker Compose

```yaml
# docker-compose.yml  (place next to Dockerfile below)
version: "3.9"
services:
  galaxy-mp:
    build: ./backend
    restart: unless-stopped
    ports:
      - "8765:8765"
    volumes:
      - ./backend/leaderboard.json:/app/leaderboard.json
    command: ["python", "server.py", "--host", "0.0.0.0", "--port", "8765"]
```

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY server.py .
RUN pip install --no-cache-dir websockets
EXPOSE 8765
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8765"]
```

```bash
docker compose up -d
docker compose logs -f galaxy-mp
```

---

## Option B — Cloudflare Worker with Durable Objects

### Requirements

- Free Cloudflare account
- Node.js 18+
- Wrangler CLI

### Setup

```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Log in to Cloudflare
wrangler login

# 3. Go to the backend directory
cd /path/to/fedya-site/backend

# 4. Create the KV namespace for the leaderboard
wrangler kv:namespace create LEADERBOARD_KV
# Copy the "id" from the output and paste it into wrangler.toml:
#   id = "PASTE_HERE"

# 5. Deploy
wrangler deploy

# Output will show:  https://fedya-galaxy-mp.<your-subdomain>.workers.dev
```

### Custom domain (optional)

In `wrangler.toml`, uncomment the `[[routes]]` section and fill in your domain.  
Or add a route in the Cloudflare dashboard under Workers & Pages → your worker → Triggers.

### Local development

```bash
wrangler dev
# Starts a local server at http://localhost:8787
# WS endpoint: ws://localhost:8787/ws?room=TEST
```

---

## Configuring the frontend

Open `multiplayer.js` and locate the `MultiplayerManager` section near the bottom.
Change the default server URL to your deployment:

```javascript
// Option A — Python server
let _serverUrl = 'wss://yourdomain.com';

// Option B — Cloudflare Worker
let _serverUrl = 'wss://fedya-galaxy-mp.<your-subdomain>.workers.dev';
```

Or pass the URL when initialising from your game's main script:

```javascript
// In your game startup code, after creating the SpaceGame instance:
MultiplayerManager.init(game, 'wss://yourdomain.com');

// Show the lobby when the player clicks "Multiplayer":
document.getElementById('btn-multiplayer').addEventListener('click', () => {
  MultiplayerManager.showLobby();
});
```

The WebSocket URL must use `wss://` (TLS) in production — plain `ws://` only works on localhost.

---

## WebSocket URL format

| Backend | URL |
|---------|-----|
| Python (nginx/Caddy) | `wss://yourdomain.com/ws` |
| Cloudflare Worker | `wss://fedya-galaxy-mp.<sub>.workers.dev/ws?room=CODE` |

The room code can also be sent in the first `join` message — the Python server accepts it either way.  
The Cloudflare Worker requires it in the query string (`?room=CODE`) at connection time because Durable Object routing happens before the first message.

---

## Leaderboard API

Both backends expose a leaderboard endpoint:

```
GET https://yourdomain.com/leaderboard
```

Response (JSON array, up to 100 entries, sorted by score descending):

```json
[
  { "name": "Fedya", "score": 12400, "wave": 7, "ts": 1712345678 },
  ...
]
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Server unreachable" in the lobby | Check that the server is running and the port is open in your firewall |
| Connection drops immediately | Make sure nginx/Caddy is passing `Upgrade: websocket` headers |
| "Room full" error | Only 2 players per room; use a different room code |
| Cloudflare: "Durable Objects not enabled" | Go to Workers & Pages → your worker → Settings → enable Durable Objects |
| `wrangler deploy` fails on KV | Run `wrangler kv:namespace create LEADERBOARD_KV` and update `wrangler.toml` |
| Enemies out of sync | The server is authoritative for spawning; clients simulate physics. Ensure both clients are on the same `game.js` version |

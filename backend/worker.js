/**
 * Fedya Galaxy Explorer — Cloudflare Worker + Durable Objects
 * ==============================================================
 * Alternative to the Python backend.  Every active room lives in its own
 * Durable Object instance so state is isolated and automatically garbage-
 * collected when idle.
 *
 * Deploy:
 *   wrangler deploy
 *
 * See wrangler.toml in this directory and backend/README.md for full setup.
 *
 * Protocol is identical to server.py — see README for message reference.
 */

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_PLAYERS        = 2;
const PING_INTERVAL_MS   = 25_000;
const ROOM_IDLE_TIMEOUT  = 300_000;   // 5 min in ms; DOs have their own eviction
const ENEMY_HP_MULT      = 1.5;
const ENEMY_COUNT_BONUS  = 0.5;
const WAVE_PAUSE_MS      = 4_000;

const ENEMY_TEMPLATES = [
  { type: 'scout',   hp: 30,  speed: 2.0 },
  { type: 'fighter', hp: 60,  speed: 1.5 },
  { type: 'bomber',  hp: 120, speed: 0.8 },
  { type: 'elite',   hp: 200, speed: 1.2 },
  { type: 'boss',    hp: 600, speed: 0.6 },
];

const UPGRADE_POOL = [
  { id: 'tripleShot',   label: 'Triple Shot',     description: 'Fire 3 bullets in a spread' },
  { id: 'rapidFire',    label: 'Rapid Fire',       description: '+40 % fire rate' },
  { id: 'shield',       label: 'Energy Shield',    description: 'Absorbs one hit' },
  { id: 'speedBoost',   label: 'Afterburner',      description: '+25 % ship speed' },
  { id: 'piercingShot', label: 'Piercing Rounds',  description: 'Bullets pass through enemies' },
  { id: 'wideBeam',     label: 'Wide Beam',        description: 'Laser sweeps a wider arc' },
  { id: 'homing',       label: 'Homing Missiles',  description: 'Missiles track nearest enemy' },
  { id: 'hpRegen',      label: 'Nano-Repair',      description: 'Slowly regenerate HP' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function uuid8() {
  return crypto.randomUUID().slice(0, 8);
}

function sample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function json(obj) {
  return JSON.stringify(obj);
}

// ── Worker entry point ─────────────────────────────────────────────────────

export default {
  /**
   * Route WebSocket upgrades to the correct GameRoom Durable Object.
   * Non-WebSocket requests get a simple health-check JSON response.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(json({ status: 'ok', service: 'galaxy-mp' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Leaderboard read endpoint
    if (url.pathname === '/leaderboard' && request.method === 'GET') {
      const stored = await env.LEADERBOARD_KV.get('board');
      const board  = stored ? JSON.parse(stored) : [];
      return new Response(json(board), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // WebSocket upgrade — must be on /ws or /ws/<roomCode>
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Extract room code from query string if provided upfront,
      // otherwise the client sends it in the first "join" message.
      // We use a placeholder DO name until the join message arrives;
      // but since we need a DO name at routing time we default to a
      // temporary per-connection DO and let the DO handle routing.
      //
      // Simpler approach: require ?room=CODE in the WS URL.
      const roomCode = (url.searchParams.get('room') || 'LOBBY').toUpperCase().slice(0, 4);
      const doId     = env.GAME_ROOM.idFromName(roomCode);
      const stub     = env.GAME_ROOM.get(doId);
      return stub.fetch(request);
    }

    return new Response(
      json({ error: 'Not found', hint: 'Connect to /ws?room=CODE' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  },
};

// ── GameRoom Durable Object ────────────────────────────────────────────────

export class GameRoom {
  constructor(state, env) {
    this.state   = state;        // Durable Object state
    this.env     = env;
    this.storage = state.storage;

    /** @type {Map<WebSocket, {id:string, name:string, score:number, hp:number, dead:boolean, lastSeen:number}>} */
    this.players = new Map();

    this.wave          = 0;
    this.active        = false;
    /** @type {Map<string, object>} */
    this.enemies       = new Map();
    this.upgradeTurn   = 0;
    this.lastActivity  = Date.now();

    this._pingTimer    = null;
    this._waveTimer    = null;
    this._idleTimer    = null;

    // Restore hibernation-safe WebSocket sessions
    this.state.getWebSockets().forEach(ws => {
      const meta = ws.deserializeAttachment();
      if (meta) this.players.set(ws, meta);
    });
  }

  // ── Fetch handler (Durable Object) ───────────────────────────────────

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);

    this.lastActivity = Date.now();
    this._resetIdleTimer();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket event handlers (CF hibernation API) ─────────────────────

  async webSocketMessage(ws, raw) {
    this.lastActivity = Date.now();
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const player = this.players.get(ws);
    const type   = msg.type;

    if (type === 'join') {
      await this._handleJoin(ws, msg);
      return;
    }

    if (!player) {
      ws.send(json({ type: 'error', message: 'Not joined yet' }));
      return;
    }

    switch (type) {
      case 'state':       await this._handleState(ws, player, msg);  break;
      case 'shoot':       await this._handleShoot(ws, player, msg);  break;
      case 'enemy_kill':  await this._handleEnemyKill(player, msg);  break;
      case 'upgrade':     await this._handleUpgrade(player, msg);    break;
      case 'request_revive': await this._handleRequestRevive(player); break;
      case 'revive':      await this._handleRevive(player, msg);     break;
      case 'pong':        player.lastSeen = Date.now();               break;
      case 'leave':       ws.close(1000, 'Bye'); break;
      default: break;
    }
  }

  async webSocketClose(ws, code, reason) {
    await this._cleanupPlayer(ws);
  }

  async webSocketError(ws, error) {
    await this._cleanupPlayer(ws);
  }

  // ── Message handlers ─────────────────────────────────────────────────

  async _handleJoin(ws, msg) {
    if (this.players.size >= MAX_PLAYERS) {
      ws.send(json({ type: 'error', message: 'Room full' }));
      ws.close(1008, 'Room full');
      return;
    }

    const playerId = uuid8();
    const name     = String(msg.name || 'Pilot').slice(0, 20).trim() || 'Pilot';
    const player   = { id: playerId, name, score: 0, hp: 100, dead: false, lastSeen: Date.now() };

    this.players.set(ws, player);
    ws.serializeAttachment(player);   // survive hibernation

    // Acknowledge join
    ws.send(json({
      type:     'joined',
      playerId,
      roomCode: this._roomCode(),
      players:  this._playerList(),
    }));

    // Notify existing players
    await this._broadcast({ type: 'player_joined', playerId, name }, ws);

    // Start game when room is full
    if (this.players.size === MAX_PLAYERS && !this.active) {
      this._startPingLoop();
      await this._startWave();
    }
  }

  async _handleState(ws, player, msg) {
    const data = msg.data || {};
    if (data.hp !== undefined) player.hp = data.hp;
    if (data.dead) {
      player.dead = true;
      await this._checkGameOver();
    }
    ws.serializeAttachment(player);
    await this._broadcast({ type: 'player_state', playerId: player.id, data }, ws);
  }

  async _handleShoot(ws, player, msg) {
    await this._broadcast({ type: 'player_shoot', playerId: player.id, data: msg.data || {} }, ws);
  }

  async _handleEnemyKill(player, msg) {
    const enemyId = String((msg.data || {}).id || '');
    if (!enemyId || !this.enemies.has(enemyId)) return;

    this.enemies.delete(enemyId);
    player.score += 100 + this.wave * 10;

    await this._broadcastAll({ type: 'sync_score', playerId: player.id, score: player.score });

    if (this.enemies.size === 0) {
      await this._endWave();
    }
  }

  async _handleUpgrade(player, msg) {
    const upgradeId = String(msg.upgradeId || '');
    await this._broadcastAll({ type: 'upgrade_applied', playerId: player.id, upgradeId });
  }

  async _handleRequestRevive(player) {
    for (const [ws2, p2] of this.players.entries()) {
      if (p2.id !== player.id && !p2.dead) {
        ws2.send(json({ type: 'revive_available', targetId: player.id, targetName: player.name }));
      }
    }
  }

  async _handleRevive(reviverPlayer, msg) {
    const targetId = String(msg.targetId || '');
    for (const [ws2, p2] of this.players.entries()) {
      if (p2.id === targetId && p2.dead) {
        p2.dead = false;
        p2.hp   = 50;
        ws2.serializeAttachment(p2);
        await this._broadcastAll({ type: 'revived', targetId, revivedBy: reviverPlayer.id });
        ws2.send(json({ type: 'player_state', playerId: targetId, data: { hp: 50, dead: false } }));
        break;
      }
    }
  }

  // ── Wave logic ────────────────────────────────────────────────────────

  _enemyCountForWave(wave) {
    return Math.floor((5 + wave * 3) * (1 + ENEMY_COUNT_BONUS));
  }

  _buildEnemies(wave) {
    const count   = this._enemyCountForWave(wave);
    const tierIdx = Math.min(wave - 1, ENEMY_TEMPLATES.length - 1);
    const result  = [];
    for (let i = 0; i < count; i++) {
      const tmpl = ENEMY_TEMPLATES[Math.max(0, tierIdx - (i % 3 === 0 ? 0 : 1))];
      result.push({
        id:   uuid8(),
        type: tmpl.type,
        x:    50 + Math.random() * 700,
        y:    -30 - Math.random() * 170,
        hp:   Math.floor(tmpl.hp * ENEMY_HP_MULT),
        wave,
      });
    }
    return result;
  }

  async _startWave() {
    this.wave  += 1;
    this.active = true;
    const enemies = this._buildEnemies(this.wave);
    enemies.forEach(e => this.enemies.set(e.id, e));

    await this._broadcastAll({
      type:        'wave_start',
      wave:        this.wave,
      enemyCount:  this._enemyCountForWave(this.wave),
    });

    // Spawn in batches
    const BATCH = 5;
    for (let i = 0; i < enemies.length; i += BATCH) {
      const batch = enemies.slice(i, i + BATCH);
      await this._broadcastAll({ type: 'enemy_spawn', enemies: batch });
      if (i + BATCH < enemies.length) {
        await this._sleep(300);
      }
    }
  }

  async _endWave() {
    this.active = false;

    if (this.players.size === 0) return;

    const playerEntries = [...this.players.values()];
    const chooser       = playerEntries[this.upgradeTurn % playerEntries.length];
    this.upgradeTurn++;

    const options = sample(UPGRADE_POOL, 3);
    await this._broadcastAll({ type: 'upgrade_choice', playerId: chooser.id, options });

    await this._sleep(WAVE_PAUSE_MS);
    if (this.players.size > 0) {
      await this._startWave();
    }
  }

  // ── Game over ─────────────────────────────────────────────────────────

  async _checkGameOver() {
    const alive = [...this.players.values()].filter(p => !p.dead);
    if (alive.length > 0) return;

    const scores = [...this.players.values()]
      .map(p => ({ name: p.name, score: p.score, wave: this.wave }))
      .sort((a, b) => b.score - a.score);

    await this._broadcastAll({ type: 'game_over', scores });
    await this._saveLeaderboard(scores);
  }

  async _saveLeaderboard(scores) {
    if (!this.env.LEADERBOARD_KV) return;
    try {
      const existing = await this.env.LEADERBOARD_KV.get('board');
      const board    = existing ? JSON.parse(existing) : [];
      scores.forEach(s => board.push({ ...s, ts: Date.now() }));
      board.sort((a, b) => b.score - a.score);
      await this.env.LEADERBOARD_KV.put('board', JSON.stringify(board.slice(0, 100)));
    } catch (e) {
      console.error('Leaderboard save failed:', e);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  async _cleanupPlayer(ws) {
    const player = this.players.get(ws);
    if (!player) return;
    this.players.delete(ws);
    this.lastActivity = Date.now();

    await this._broadcast({ type: 'player_left', playerId: player.id });

    if (this.players.size === 0) {
      this._stopPingLoop();
      this._resetIdleTimer();
    }
  }

  // ── Broadcast helpers ─────────────────────────────────────────────────

  async _broadcastAll(msg) {
    const s = json(msg);
    for (const ws of this.players.keys()) {
      try { ws.send(s); } catch {}
    }
  }

  async _broadcast(msg, excludeWs = null) {
    const s = json(msg);
    for (const ws of this.players.keys()) {
      if (ws !== excludeWs) {
        try { ws.send(s); } catch {}
      }
    }
  }

  // ── Ping loop ─────────────────────────────────────────────────────────

  _startPingLoop() {
    this._stopPingLoop();
    this._pingTimer = setInterval(async () => {
      await this._broadcastAll({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  _stopPingLoop() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  // ── Idle eviction ─────────────────────────────────────────────────────

  _resetIdleTimer() {
    if (this._idleTimer) { clearTimeout(this._idleTimer); }
    this._idleTimer = setTimeout(() => {
      // Close any straggling sockets — DO will be evicted naturally
      for (const ws of this.players.keys()) {
        try { ws.close(1001, 'Room idle timeout'); } catch {}
      }
      this.players.clear();
      this.enemies.clear();
      this._stopPingLoop();
    }, ROOM_IDLE_TIMEOUT);
  }

  // ── Misc helpers ──────────────────────────────────────────────────────

  _roomCode() {
    // Durable Object name is the room code — access via state.id.name
    return this.state.id.name || 'ROOM';
  }

  _playerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, score: p.score, hp: p.hp,
    }));
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEDYA GALAXY EXPLORER — multiplayer.js
   WebSocket client for 2-player cooperative space shooter.

   Usage:
     const client = new MultiplayerClient(game, 'wss://yourserver.example.com');
     await client.connect('STAR', 'Fedya');
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────
   MultiplayerClient
   ───────────────────────────────────────────────────────────────────────── */
class MultiplayerClient {
  /**
   * @param {object} game      - SpaceGame instance
   * @param {string} serverUrl - WebSocket server URL, e.g. 'wss://example.com'
   */
  constructor(game, serverUrl) {
    this._game      = game;
    this._serverUrl = serverUrl.replace(/\/$/, '');

    this._ws         = null;
    this._connected  = false;
    this._roomCode   = null;
    this._playerId   = null;
    this._playerName = null;
    this._players    = [];           // [{id, name, score, hp}]

    this._stateInterval  = null;
    this._reconnectTimer = null;
    this._manualClose    = false;
    this._reconnectAttempts = 0;
    this._MAX_RECONNECT  = 5;

    // Bind game event listeners so we can forward them to the server
    this._bindGameEvents();
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  /**
   * Connect to a room.
   * @param {string} roomCode  - 4-letter room code, e.g. 'STAR'
   * @param {string} playerName
   * @returns {Promise} Resolves when joined, rejects on error / timeout
   */
  connect(roomCode, playerName) {
    return new Promise((resolve, reject) => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        reject(new Error('Already connected. Call disconnect() first.'));
        return;
      }

      this._roomCode   = roomCode.toUpperCase();
      this._playerName = playerName;
      this._manualClose = false;

      const url = `${this._serverUrl}/ws`;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(new Error(`Cannot open WebSocket to ${url}: ${err.message}`));
        return;
      }
      this._ws = ws;

      // Timeout if server never responds
      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          reject(new Error('Connection timeout — server unreachable. See backend/README.md for setup.'));
        }
      }, 8000);

      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        this._send({ type: 'join', room: this._roomCode, name: this._playerName });
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'joined') {
          this._connected = true;
          this._playerId  = msg.playerId;
          this._players   = msg.players || [];
          this._reconnectAttempts = 0;

          // Register remote players already in the room
          this._players
            .filter(p => p.id !== this._playerId)
            .forEach(p => this._game.addRemotePlayer(p.id, p.name));

          // Enable multiplayer mode in the game engine
          this._game.setMultiplayerMode(this);

          // Start sending local state at 20 Hz
          this._startStateSync();

          MultiplayerUI.showWaitingRoom(this._roomCode, this._players, this._playerId);
          resolve(this);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.message || 'Server error'));
        }

        // Route all subsequent messages even before the 'joined' response
        // so we don't miss anything arriving concurrently.
        this._handleMessage(msg);
      });

      ws.addEventListener('close', (event) => {
        clearTimeout(timeout);
        this._onClose(event);
      });

      ws.addEventListener('error', () => {
        // The 'close' event fires right after; let that handler deal with it.
        // If we never opened, reject the connect() promise.
        if (!this._connected) {
          clearTimeout(timeout);
          reject(new Error(
            `WebSocket error connecting to ${url}. ` +
            'Is the server running? See backend/README.md for setup instructions.'
          ));
        }
      });
    });
  }

  disconnect() {
    this._manualClose = true;
    this._stopStateSync();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) {
      this._send({ type: 'leave' });
      this._ws.close(1000, 'Client disconnect');
      this._ws = null;
    }
    this._connected = false;
    MultiplayerUI.hide();
  }

  isConnected()  { return this._connected; }
  getRoomCode()  { return this._roomCode; }
  getPlayers()   { return [...this._players]; }

  /**
   * Generate a random 4-letter room code.
   * Uses letters that are easy to read and share verbally.
   */
  static generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O to avoid confusion
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /* ── Message handling ───────────────────────────────────────────────── */

  _handleMessage(msg) {
    switch (msg.type) {
      case 'joined':
        // Already handled in connect(); ignore duplicates here.
        break;

      case 'player_joined': {
        const existing = this._players.find(p => p.id === msg.playerId);
        if (!existing) {
          this._players.push({ id: msg.playerId, name: msg.name, score: 0, hp: 100 });
        }
        this._game.addRemotePlayer(msg.playerId, msg.name);
        MultiplayerUI.updatePlayerList(this._players, this._playerId);
        MultiplayerUI.showToast(`${msg.name} joined the room!`);
        break;
      }

      case 'player_left': {
        this._players = this._players.filter(p => p.id !== msg.playerId);
        this._game.removeRemotePlayer(msg.playerId);
        MultiplayerUI.updatePlayerList(this._players, this._playerId);
        MultiplayerUI.showToast('Your co-pilot left the room.');
        break;
      }

      case 'player_state': {
        if (msg.playerId === this._playerId) break; // ignore echo of own state
        // Update local player list with latest hp/score if present
        const p = this._players.find(pl => pl.id === msg.playerId);
        if (p) {
          if (msg.data.hp    !== undefined) p.hp    = msg.data.hp;
          if (msg.data.score !== undefined) p.score = msg.data.score;
        }
        this._game.applyRemotePlayerState(msg.playerId, msg.data);
        break;
      }

      case 'enemy_spawn': {
        (msg.enemies || []).forEach(e => this._game.spawnRemoteEnemy(e));
        break;
      }

      case 'enemy_update': {
        // For each updated enemy, fire an internal game event so the engine
        // can reconcile positions/HP without us knowing internal enemy storage.
        (msg.enemies || []).forEach(e => {
          this._game.emit('enemy:serverUpdate', e);
        });
        break;
      }

      case 'wave_start': {
        this._game.emit('wave:serverStart', { wave: msg.wave, enemyCount: msg.enemyCount });
        MultiplayerUI.showToast(`Wave ${msg.wave} — ${msg.enemyCount} enemies incoming!`);
        break;
      }

      case 'upgrade_choice': {
        if (msg.playerId === this._playerId) {
          MultiplayerUI.showUpgradeChoice(msg.options, (upgradeId) => {
            this._send({ type: 'upgrade', upgradeId });
          });
        } else {
          const player = this._players.find(p => p.id === msg.playerId);
          const name = player ? player.name : 'Co-pilot';
          MultiplayerUI.showToast(`${name} is choosing an upgrade…`);
        }
        break;
      }

      case 'sync_score': {
        // Server can push authoritative score updates
        const pl = this._players.find(p => p.id === msg.playerId);
        if (pl) pl.score = msg.score;
        this._game.syncScore(msg.playerId, msg.score);
        MultiplayerUI.updatePlayerList(this._players, this._playerId);
        break;
      }

      case 'game_over': {
        this._stopStateSync();
        MultiplayerUI.showGameOver(msg.scores || []);
        break;
      }

      case 'revive_available': {
        // Server tells this player they can revive a fallen co-pilot
        MultiplayerUI.showReviveIndicator(msg.targetId, msg.targetName);
        break;
      }

      case 'revived': {
        const revived = this._players.find(p => p.id === msg.targetId);
        const reviveName = revived ? revived.name : 'Co-pilot';
        MultiplayerUI.showToast(`${reviveName} has been revived!`);
        MultiplayerUI.hideReviveIndicator();
        break;
      }

      case 'ping': {
        this._send({ type: 'pong' });
        break;
      }

      default:
        // Unknown message type — silently ignore
        break;
    }
  }

  /* ── Game event → server forwarding ─────────────────────────────────── */

  _bindGameEvents() {
    const g = this._game;

    g.on('player:shoot', (data) => {
      if (!this._connected) return;
      this._send({ type: 'shoot', data });
    });

    g.on('player:hit', (data) => {
      if (!this._connected) return;
      // State sync at 20 Hz already carries hp; this is an immediate urgent update
      const state = g.getLocalPlayerState();
      this._send({ type: 'state', data: state });
    });

    g.on('player:dead', () => {
      if (!this._connected) return;
      this._send({ type: 'state', data: { ...g.getLocalPlayerState(), dead: true } });
      MultiplayerUI.showDeadOverlay(() => {
        // Player requests to be revived — server broadcasts revive_available to partner
        this._send({ type: 'request_revive' });
      });
    });

    g.on('player:upgrade', (data) => {
      // Upgrade selection is handled via upgrade_choice flow;
      // this fires after the game applies it locally.
    });

    g.on('enemy:kill', (data) => {
      if (!this._connected) return;
      this._send({ type: 'enemy_kill', data });
    });

    g.on('wave:complete', (data) => {
      if (!this._connected) return;
      this._send({ type: 'wave_complete', data });
    });

    g.on('game:ready', () => {
      // Game canvas is ready — show multiplayer UI in HUD mode
      if (this._connected) {
        MultiplayerUI.showHUD(this._players, this._playerId);
      }
    });

    g.on('game:over', () => {
      if (!this._connected) return;
      this._send({ type: 'game_over_local' });
    });
  }

  /* ── State sync ──────────────────────────────────────────────────────── */

  _startStateSync() {
    if (this._stateInterval) return;
    this._stateInterval = setInterval(() => {
      if (!this._connected) return;
      const state = this._game.getLocalPlayerState();
      this._send({ type: 'state', data: state });
    }, 50); // 20 Hz
  }

  _stopStateSync() {
    if (this._stateInterval) {
      clearInterval(this._stateInterval);
      this._stateInterval = null;
    }
  }

  /* ── Connection helpers ──────────────────────────────────────────────── */

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  _onClose(event) {
    this._connected = false;
    this._stopStateSync();

    if (this._manualClose) return;

    // Abnormal close — try to reconnect
    if (this._reconnectAttempts < this._MAX_RECONNECT) {
      this._reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** (this._reconnectAttempts - 1), 16000);
      MultiplayerUI.showReconnecting(this._reconnectAttempts, this._MAX_RECONNECT, delay);
      this._reconnectTimer = setTimeout(() => {
        this.connect(this._roomCode, this._playerName).catch(() => {
          // Will retry via _onClose again until MAX_RECONNECT
        });
      }, delay);
    } else {
      MultiplayerUI.showConnectionLost(() => {
        // Manual reconnect button pressed
        this._reconnectAttempts = 0;
        this.connect(this._roomCode, this._playerName).catch(err => {
          MultiplayerUI.showError(err.message);
        });
      });
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   MultiplayerUI
   All in-game overlays and HUD elements for multiplayer.
   ───────────────────────────────────────────────────────────────────────── */
const MultiplayerUI = (() => {

  /* ── DOM helpers ───────────────────────────────────────────────────── */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'html')  node.innerHTML = v;
      else if (k === 'style') Object.assign(node.style, v);
      else node.setAttribute(k, v);
    });
    children.forEach(c => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function overlay(id, content) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const wrap = el('div', { id, class: 'mp-overlay' });
    wrap.appendChild(content);
    document.body.appendChild(wrap);
    return wrap;
  }

  let _toastTimer = null;

  /* ── Styles (injected once) ─────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('mp-styles')) return;
    const style = document.createElement('style');
    style.id = 'mp-styles';
    style.textContent = `
      /* ── Base overlay ── */
      .mp-overlay {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,10,0.82);
        backdrop-filter: blur(4px);
        font-family: 'Orbitron', 'Exo 2', monospace;
        color: #e0f0ff;
        animation: mp-fade-in 0.25s ease;
      }
      @keyframes mp-fade-in { from { opacity:0; } to { opacity:1; } }

      /* ── Panel ── */
      .mp-panel {
        background: linear-gradient(160deg, #0a0f2e 0%, #05090f 100%);
        border: 1px solid #1a4080;
        border-radius: 12px;
        padding: 32px 36px;
        max-width: 480px; width: 90%;
        box-shadow: 0 0 40px rgba(0,120,255,0.25), inset 0 0 30px rgba(0,40,120,0.15);
      }
      .mp-panel h2 {
        margin: 0 0 20px;
        font-size: 1.25rem; letter-spacing: 0.12em;
        color: #60b0ff;
        text-transform: uppercase;
      }
      .mp-panel label {
        display: block; font-size: 0.72rem; letter-spacing: 0.1em;
        color: #7090b0; margin-bottom: 4px; text-transform: uppercase;
      }
      .mp-panel input {
        width: 100%; box-sizing: border-box;
        background: #091428; border: 1px solid #1a3060;
        color: #c8e0ff; border-radius: 6px; padding: 10px 12px;
        font-family: inherit; font-size: 1rem; letter-spacing: 0.05em;
        margin-bottom: 16px; outline: none;
        transition: border-color 0.2s;
      }
      .mp-panel input:focus { border-color: #4080d0; }
      .mp-panel input.room-code {
        text-transform: uppercase; font-size: 1.4rem;
        letter-spacing: 0.25em; text-align: center;
      }

      /* ── Buttons ── */
      .mp-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 11px 22px; border-radius: 7px; border: none;
        font-family: inherit; font-size: 0.85rem; letter-spacing: 0.1em;
        cursor: pointer; transition: all 0.18s; text-transform: uppercase;
      }
      .mp-btn-primary {
        background: linear-gradient(135deg, #1a4fa0, #0d308a);
        color: #c8e8ff;
        box-shadow: 0 0 16px rgba(0,80,200,0.4);
      }
      .mp-btn-primary:hover { background: linear-gradient(135deg, #2460c0, #1040a0); box-shadow: 0 0 24px rgba(0,100,240,0.6); }
      .mp-btn-secondary {
        background: rgba(20,50,100,0.5); color: #80a8d0; border: 1px solid #1a3060;
      }
      .mp-btn-secondary:hover { background: rgba(30,70,140,0.6); color: #a0c8f0; }
      .mp-btn-danger { background: linear-gradient(135deg, #901020, #600010); color: #ffc0c8; box-shadow: 0 0 16px rgba(200,0,30,0.3); }
      .mp-btn-danger:hover { background: linear-gradient(135deg, #b01828, #801020); }
      .mp-btn-row { display: flex; gap: 10px; flex-wrap: wrap; }

      /* ── Room code display ── */
      .mp-room-code-display {
        background: #06101e; border: 1px solid #1a3060; border-radius: 8px;
        padding: 14px; margin-bottom: 18px; text-align: center;
      }
      .mp-room-code-display small { display: block; color: #5070a0; font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px; }
      .mp-room-code-display span { font-size: 2.2rem; letter-spacing: 0.4em; color: #60c0ff; font-weight: 700; }
      .mp-copy-btn { background: none; border: none; color: #4080d0; cursor: pointer; font-size: 1rem; padding: 0 6px; }
      .mp-copy-btn:hover { color: #80c0ff; }

      /* ── Player list ── */
      .mp-player-list { list-style: none; padding: 0; margin: 0 0 20px; }
      .mp-player-list li {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 10px; border-radius: 6px; margin-bottom: 6px;
        background: rgba(10,30,70,0.5); border: 1px solid #102040;
        font-size: 0.85rem;
      }
      .mp-player-list li.is-you { border-color: #204888; background: rgba(10,40,100,0.6); }
      .mp-player-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .mp-player-dot-blue { background: #3080ff; box-shadow: 0 0 6px #3080ff; }
      .mp-player-dot-green { background: #30c060; box-shadow: 0 0 6px #30c060; }
      .mp-player-name { flex: 1; }
      .mp-player-badge { font-size: 0.65rem; letter-spacing: 0.08em; color: #4060a0; }

      /* ── Waiting indicator ── */
      .mp-waiting {
        display: flex; align-items: center; gap: 10px;
        color: #5080b0; font-size: 0.78rem; letter-spacing: 0.08em;
        margin-bottom: 18px;
      }
      .mp-waiting-dots span {
        display: inline-block; width: 6px; height: 6px; border-radius: 50%;
        background: #3060a0; margin: 0 2px;
        animation: mp-dot-bounce 1.2s ease-in-out infinite;
      }
      .mp-waiting-dots span:nth-child(2) { animation-delay: 0.2s; }
      .mp-waiting-dots span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes mp-dot-bounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-5px);opacity:1} }

      /* ── Toast ── */
      #mp-toast {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: rgba(5,20,50,0.92); border: 1px solid #1a4070;
        color: #90c0ff; padding: 10px 20px; border-radius: 8px;
        font-family: 'Orbitron', monospace; font-size: 0.78rem; letter-spacing: 0.08em;
        z-index: 2000; pointer-events: none;
        transition: opacity 0.3s;
      }
      #mp-toast.hidden { opacity: 0; }

      /* ── HUD ── */
      #mp-hud {
        position: fixed; top: 12px; right: 12px; z-index: 900;
        background: rgba(4,12,30,0.7); border: 1px solid #102040;
        border-radius: 8px; padding: 8px 12px; min-width: 160px;
        font-family: 'Orbitron', monospace; font-size: 0.7rem; pointer-events: none;
      }
      .mp-hud-player { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
      .mp-hud-player:last-child { margin-bottom: 0; }
      .mp-hud-name { flex: 1; color: #80b0e0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mp-hud-score { color: #50a0ff; }
      .mp-hud-hp { font-size: 0.62rem; color: #306060; }

      /* ── Upgrade choice ── */
      .mp-upgrade-list { list-style: none; padding: 0; margin: 0 0 8px; }
      .mp-upgrade-list li {
        padding: 10px 14px; margin-bottom: 8px; border-radius: 7px;
        background: rgba(10,30,80,0.5); border: 1px solid #1a3060;
        cursor: pointer; transition: all 0.15s;
      }
      .mp-upgrade-list li:hover { background: rgba(20,60,140,0.7); border-color: #3060b0; }
      .mp-upgrade-title { font-size: 0.88rem; color: #90d0ff; margin-bottom: 3px; }
      .mp-upgrade-desc  { font-size: 0.72rem; color: #5080a0; }

      /* ── Dead overlay ── */
      .mp-dead-panel { text-align: center; }
      .mp-dead-panel h2 { color: #ff4060; font-size: 1.5rem; }
      .mp-dead-panel p  { color: #8090b0; font-size: 0.85rem; }

      /* ── Revive indicator ── */
      #mp-revive-indicator {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        z-index: 950; background: rgba(0,40,10,0.8); border: 1px solid #10a030;
        border-radius: 10px; padding: 14px 22px; text-align: center;
        font-family: 'Orbitron', monospace; color: #40ff80; font-size: 0.8rem;
        animation: mp-fade-in 0.2s ease; pointer-events: none;
      }

      /* ── Status bar ── */
      .mp-status { font-size: 0.72rem; color: #406080; margin-top: 12px; letter-spacing: 0.06em; }
      .mp-status.ok  { color: #30a060; }
      .mp-status.err { color: #d03040; }

      /* ── Game over ── */
      .mp-scores { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.82rem; }
      .mp-scores th { color: #4070b0; text-align: left; padding: 5px 8px; border-bottom: 1px solid #102040; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.68rem; }
      .mp-scores td { padding: 7px 8px; border-bottom: 1px solid #0a1828; color: #90b8e0; }
      .mp-scores tr.top td { color: #60d0ff; }
    `;
    document.head.appendChild(style);
  }

  /* ── Connection lobby ───────────────────────────────────────────────── */
  function showLobby(opts = {}) {
    injectStyles();
    const {
      onCreateRoom,
      onJoinRoom,
      onCancel,
    } = opts;

    const savedName = localStorage.getItem('mp_player_name') || '';
    const generatedCode = MultiplayerClient.generateRoomCode();

    const panel = el('div', { class: 'mp-panel' });

    const title = el('h2', {}, '★ Multiplayer Co-op');

    const nameLabel = el('label', {}, 'Your Call Sign');
    const nameInput = el('input', { type: 'text', placeholder: 'Fedya', value: savedName, maxlength: '20' });

    const codeLabel = el('label', {}, 'Room Code');
    const codeInput = el('input', {
      type: 'text', class: 'room-code', placeholder: 'STAR',
      value: generatedCode, maxlength: '4',
    });

    const genBtn = el('button', { class: 'mp-btn mp-btn-secondary', style: { marginBottom: '16px', fontSize: '0.75rem' } }, '↻ Random Code');
    genBtn.addEventListener('click', () => { codeInput.value = MultiplayerClient.generateRoomCode(); });

    const btnRow = el('div', { class: 'mp-btn-row' });
    const createBtn = el('button', { class: 'mp-btn mp-btn-primary' }, '+ Create Room');
    const joinBtn   = el('button', { class: 'mp-btn mp-btn-secondary' }, '→ Join Room');
    const cancelBtn = el('button', { class: 'mp-btn mp-btn-secondary' }, '✕ Cancel');

    btnRow.append(createBtn, joinBtn, cancelBtn);

    const status = el('div', { class: 'mp-status' }, 'Enter a room code or generate one, then invite a friend to the same code.');

    panel.append(title, nameLabel, nameInput, codeLabel, codeInput, genBtn, btnRow, status);
    const wrap = overlay('mp-lobby', panel);

    function getName()     { return nameInput.value.trim() || 'Pilot'; }
    function getCode()     { return codeInput.value.trim().toUpperCase(); }
    function setStatus(msg, type = '') {
      status.textContent = msg;
      status.className = 'mp-status ' + type;
    }
    function setLoading(loading) {
      createBtn.disabled = joinBtn.disabled = loading;
      createBtn.textContent = loading ? '…' : '+ Create Room';
    }

    createBtn.addEventListener('click', () => {
      const name = getName(), code = getCode();
      if (!code || code.length < 2) { setStatus('Enter a room code (2-4 letters).', 'err'); return; }
      localStorage.setItem('mp_player_name', name);
      setLoading(true); setStatus('Creating room…');
      onCreateRoom && onCreateRoom(code, name, setStatus, setLoading);
    });

    joinBtn.addEventListener('click', () => {
      const name = getName(), code = getCode();
      if (!code) { setStatus('Enter the room code your friend shared.', 'err'); return; }
      localStorage.setItem('mp_player_name', name);
      setLoading(true); setStatus('Joining room…');
      onJoinRoom && onJoinRoom(code, name, setStatus, setLoading);
    });

    cancelBtn.addEventListener('click', () => {
      wrap.remove();
      onCancel && onCancel();
    });

    nameInput.focus();
    return wrap;
  }

  /* ── Waiting room (after join, before 2nd player) ───────────────────── */
  function showWaitingRoom(roomCode, players, myId) {
    injectStyles();
    const panel = el('div', { class: 'mp-panel' });

    const title = el('h2', {}, '★ Waiting for Co-Pilot…');

    const codeDisplay = el('div', { class: 'mp-room-code-display' });
    const codeSmall   = el('small', {}, 'Share this room code:');
    const codeSpan    = el('span', {}, roomCode);
    const copyBtn     = el('button', { class: 'mp-copy-btn', title: 'Copy room code' }, '⎘');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(roomCode).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500);
      });
    });
    codeDisplay.append(codeSmall, codeSpan, copyBtn);

    const waitDiv = el('div', { class: 'mp-waiting' },
      'Waiting for second player ',
      Object.assign(el('span', { class: 'mp-waiting-dots' }),
        { innerHTML: '<span></span><span></span><span></span>' })
    );

    const playerList = el('ul', { class: 'mp-player-list' });
    updatePlayerListEl(playerList, players, myId);

    const cancelBtn = el('button', { class: 'mp-btn mp-btn-secondary' }, '✕ Leave Room');
    cancelBtn.addEventListener('click', () => {
      document.getElementById('mp-waiting')?.remove();
      // Caller should call client.disconnect() after this
      window._mpCancelWait && window._mpCancelWait();
    });

    panel.append(title, codeDisplay, waitDiv, playerList, cancelBtn);
    const old = document.getElementById('mp-lobby');
    if (old) old.remove();
    overlay('mp-waiting', panel);
  }

  /* ── In-game HUD (compact, corner display) ──────────────────────────── */
  function showHUD(players, myId) {
    injectStyles();
    const existing = document.getElementById('mp-hud');
    if (existing) existing.remove();

    // Close any open overlays
    ['mp-lobby', 'mp-waiting'].forEach(id => document.getElementById(id)?.remove());

    const hud = el('div', { id: 'mp-hud' });
    hud.dataset.myId = myId;
    renderHUD(hud, players, myId);
    document.body.appendChild(hud);
  }

  function renderHUD(hud, players, myId) {
    hud.innerHTML = '';
    const colors = ['mp-player-dot-blue', 'mp-player-dot-green'];
    players.forEach((p, i) => {
      const row  = el('div', { class: 'mp-hud-player' + (p.id === myId ? ' is-you' : '') });
      const dot  = el('span', { class: 'mp-player-dot ' + (colors[i % 2]) });
      const name = el('span', { class: 'mp-hud-name' }, p.name + (p.id === myId ? ' ★' : ''));
      const score = el('span', { class: 'mp-hud-score' }, String(p.score || 0));
      const hp    = el('span', { class: 'mp-hud-hp' }, `HP:${p.hp ?? 100}`);
      row.append(dot, name, score, hp);
      hud.appendChild(row);
    });
  }

  function updatePlayerList(players, myId) {
    const hud = document.getElementById('mp-hud');
    if (hud) renderHUD(hud, players, myId);

    const waitList = document.querySelector('#mp-waiting .mp-player-list');
    if (waitList) updatePlayerListEl(waitList, players, myId);
  }

  function updatePlayerListEl(listEl, players, myId) {
    listEl.innerHTML = '';
    const colors = ['mp-player-dot-blue', 'mp-player-dot-green'];
    players.forEach((p, i) => {
      const li  = el('li', { class: p.id === myId ? 'is-you' : '' });
      const dot = el('span', { class: 'mp-player-dot ' + colors[i % 2] });
      const nm  = el('span', { class: 'mp-player-name' }, p.name);
      const bdg = el('span', { class: 'mp-player-badge' }, p.id === myId ? 'You' : 'Co-pilot');
      li.append(dot, nm, bdg);
      listEl.appendChild(li);
    });
  }

  /* ── Toast notification ─────────────────────────────────────────────── */
  function showToast(message, duration = 3000) {
    injectStyles();
    let toast = document.getElementById('mp-toast');
    if (!toast) {
      toast = el('div', { id: 'mp-toast' });
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { toast.classList.add('hidden'); }, duration);
  }

  /* ── Upgrade choice ─────────────────────────────────────────────────── */
  function showUpgradeChoice(options, onChoose) {
    injectStyles();
    const panel = el('div', { class: 'mp-panel' });
    const title = el('h2', {}, '⚡ Choose Your Upgrade');
    const note  = el('p', { style: { color: '#5080a0', fontSize: '0.78rem', margin: '0 0 14px' } },
      'One upgrade per wave. Your co-pilot will choose next time.');
    const list  = el('ul', { class: 'mp-upgrade-list' });

    (options || []).forEach(opt => {
      const li   = el('li');
      const ttl  = el('div', { class: 'mp-upgrade-title' }, opt.label || opt.id);
      const desc = el('div', { class: 'mp-upgrade-desc'  }, opt.description || '');
      li.append(ttl, desc);
      li.addEventListener('click', () => {
        onChoose(opt.id);
        document.getElementById('mp-upgrade')?.remove();
      });
      list.appendChild(li);
    });

    panel.append(title, note, list);
    overlay('mp-upgrade', panel);
  }

  /* ── Dead overlay ───────────────────────────────────────────────────── */
  function showDeadOverlay(onRequestRevive) {
    injectStyles();
    const panel = el('div', { class: 'mp-panel mp-dead-panel' });
    const title = el('h2', {}, '💀 Ship Destroyed');
    const msg   = el('p', {}, 'Your co-pilot can revive you. Fly to their beacon to come back!');
    const btn   = el('button', { class: 'mp-btn mp-btn-primary' }, '🆘 Broadcast Distress Signal');
    btn.addEventListener('click', () => {
      onRequestRevive();
      btn.disabled = true;
      btn.textContent = '📡 Signal sent — hold on…';
    });
    panel.append(title, msg, btn);
    overlay('mp-dead', panel);
  }

  /* ── Revive indicator ───────────────────────────────────────────────── */
  function showReviveIndicator(targetId, targetName) {
    injectStyles();
    let ind = document.getElementById('mp-revive-indicator');
    if (!ind) {
      ind = el('div', { id: 'mp-revive-indicator' });
      document.body.appendChild(ind);
    }
    ind.textContent = `▲ Fly to ${targetName || 'co-pilot'}'s beacon to revive them!`;
  }

  function hideReviveIndicator() {
    document.getElementById('mp-revive-indicator')?.remove();
    document.getElementById('mp-dead')?.remove();
  }

  /* ── Connection lost / reconnecting ────────────────────────────────── */
  function showReconnecting(attempt, max, delayMs) {
    injectStyles();
    const panel = el('div', { class: 'mp-panel', style: { textAlign: 'center' } });
    panel.innerHTML = `
      <h2 style="color:#f0a020">⚡ Connection Lost</h2>
      <p style="color:#8090b0;font-size:0.82rem">
        Attempting to reconnect… (${attempt}/${max})<br>
        Retrying in ${Math.round(delayMs / 1000)}s
      </p>
      <div class="mp-waiting-dots" style="justify-content:center;display:flex;gap:6px;margin-top:12px">
        <span></span><span></span><span></span>
      </div>`;
    overlay('mp-reconnecting', panel);
  }

  function showConnectionLost(onReconnect) {
    injectStyles();
    const existing = document.getElementById('mp-reconnecting');
    if (existing) existing.remove();

    const panel = el('div', { class: 'mp-panel', style: { textAlign: 'center' } });
    const title = el('h2', { style: { color: '#ff4060' } }, '✕ Connection Failed');
    const msg   = el('p', { style: { color: '#8090b0', fontSize: '0.82rem' } },
      'Could not reach the game server. Check that the backend is running. See backend/README.md for setup instructions.');
    const btn = el('button', { class: 'mp-btn mp-btn-primary', style: { margin: '0 auto' } }, '↻ Try Again');
    btn.addEventListener('click', () => {
      document.getElementById('mp-lost')?.remove();
      onReconnect();
    });
    panel.append(title, msg, btn);
    overlay('mp-lost', panel);
  }

  function showError(message) {
    injectStyles();
    showToast('Error: ' + message, 5000);
  }

  /* ── Game over ──────────────────────────────────────────────────────── */
  function showGameOver(scores) {
    injectStyles();
    ['mp-dead', 'mp-revive-indicator', 'mp-hud'].forEach(id => document.getElementById(id)?.remove());

    const panel = el('div', { class: 'mp-panel', style: { textAlign: 'center' } });
    const title = el('h2', { style: { color: '#60c0ff' } }, '★ GAME OVER ★');

    const table = el('table', { class: 'mp-scores' });
    table.innerHTML = `
      <tr><th>#</th><th>Pilot</th><th>Score</th><th>Wave</th></tr>
      ${scores.map((s, i) => `<tr class="${i === 0 ? 'top' : ''}">
        <td>${i + 1}</td><td>${s.name}</td><td>${s.score}</td><td>${s.wave || '—'}</td>
      </tr>`).join('')}`;

    const btn = el('button', { class: 'mp-btn mp-btn-secondary', style: { margin: '0 auto' } }, '↩ Back to Menu');
    btn.addEventListener('click', () => { document.getElementById('mp-gameover')?.remove(); });

    panel.append(title, table, btn);
    overlay('mp-gameover', panel);
  }

  /* ── Hide all ───────────────────────────────────────────────────────── */
  function hide() {
    ['mp-lobby','mp-waiting','mp-upgrade','mp-dead','mp-reconnecting','mp-lost','mp-gameover']
      .forEach(id => document.getElementById(id)?.remove());
    document.getElementById('mp-revive-indicator')?.remove();
    document.getElementById('mp-hud')?.remove();
    document.getElementById('mp-toast')?.remove();
  }

  return {
    showLobby, showWaitingRoom, showHUD, updatePlayerList,
    showToast, showUpgradeChoice, showDeadOverlay,
    showReviveIndicator, hideReviveIndicator,
    showReconnecting, showConnectionLost, showError,
    showGameOver, hide,
  };
})();

/* ─────────────────────────────────────────────────────────────────────────
   MultiplayerManager
   High-level entry point. Call this from your game's UI.

   Example:
     MultiplayerManager.init(game, 'wss://yourserver.example.com');
     MultiplayerManager.showLobby();
   ───────────────────────────────────────────────────────────────────────── */
const MultiplayerManager = (() => {
  let _game       = null;
  let _serverUrl  = 'ws://localhost:8765';
  let _client     = null;

  function init(game, serverUrl) {
    _game      = game;
    _serverUrl = serverUrl || _serverUrl;
  }

  function showLobby() {
    if (!_game) { console.error('MultiplayerManager: call init(game, serverUrl) first'); return; }

    MultiplayerUI.showLobby({
      onCreateRoom: async (code, name, setStatus, setLoading) => {
        try {
          _client = new MultiplayerClient(_game, _serverUrl);
          window._mpCancelWait = () => _client.disconnect();
          await _client.connect(code, name);
          setStatus('Room created! Share the code with a friend.', 'ok');
          setLoading(false);
        } catch (err) {
          setStatus(err.message, 'err');
          setLoading(false);
          _client = null;
        }
      },
      onJoinRoom: async (code, name, setStatus, setLoading) => {
        try {
          _client = new MultiplayerClient(_game, _serverUrl);
          window._mpCancelWait = () => _client.disconnect();
          await _client.connect(code, name);
          setStatus('Joined! Waiting for second player…', 'ok');
          setLoading(false);
        } catch (err) {
          setStatus(err.message, 'err');
          setLoading(false);
          _client = null;
        }
      },
      onCancel: () => {
        _client = null;
      },
    });
  }

  function disconnect() {
    if (_client) { _client.disconnect(); _client = null; }
  }

  function getClient()  { return _client; }
  function isActive()   { return !!(_client && _client.isConnected()); }

  return { init, showLobby, disconnect, getClient, isActive };
})();

// Make available globally (no ES module bundler assumed)
if (typeof window !== 'undefined') {
  window.MultiplayerClient  = MultiplayerClient;
  window.MultiplayerUI      = MultiplayerUI;
  window.MultiplayerManager = MultiplayerManager;
}

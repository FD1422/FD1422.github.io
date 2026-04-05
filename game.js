/**
 * game.js — Fedya Galaxy Explorer Space Shooter
 * A fully self-contained 2D arcade shooter engine.
 * Exposes SpaceGame class for standalone play and multiplayer extension.
 *
 * Structure:
 *  1. AudioEngine      – procedural Web Audio sounds
 *  2. ObjectPool       – generic entity recycler
 *  3. Particle         – explosion / thruster particle
 *  4. Bullet           – player and enemy projectile
 *  5. PowerUp          – collectable drop
 *  6. Ship (player)    – player entity
 *  7. Enemy            – Drone / Fighter / Boss
 *  8. WaveManager      – wave sequencing
 *  9. UpgradeSystem    – between-wave shop
 * 10. Leaderboard      – localStorage top-10
 * 11. UIRenderer       – all canvas + HTML overlays
 * 12. TouchControls    – mobile virtual joystick
 * 13. SpaceGame        – main class / public API
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. AUDIO ENGINE
   ═══════════════════════════════════════════════════════════════ */
class AudioEngine {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._enabled = true;
  }

  _init() {
    if (this._ctx) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this._ctx.createGain();
      this._master.gain.value = 0.35;
      this._master.connect(this._ctx.destination);
    } catch (e) {
      this._enabled = false;
    }
  }

  _resume() {
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
  }

  setVolume(v) {
    if (this._master) this._master.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Short high-pitched laser beep */
  playShoot(pitch = 880) {
    this._init(); this._resume();
    if (!this._enabled || !this._ctx) return;
    const now = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.4, now + 0.08);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this._master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** Enemy shoot (lower pitch) */
  playEnemyShoot() { this.playShoot(320); }

  /** Noise burst explosion */
  playExplosion(big = false) {
    this._init(); this._resume();
    if (!this._enabled || !this._ctx) return;
    const now = this._ctx.currentTime;
    const bufLen = this._ctx.sampleRate * (big ? 0.6 : 0.25);
    const buf = this._ctx.createBuffer(1, bufLen, this._ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(big ? 0.8 : 0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (big ? 0.6 : 0.25));
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = big ? 600 : 1200;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._master);
    src.start(now);
    src.stop(now + (big ? 0.65 : 0.3));
  }

  /** Ascending power-up tone */
  playPowerUp() {
    this._init(); this._resume();
    if (!this._enabled || !this._ctx) return;
    const now = this._ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => {
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      const t = now + i * 0.08;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain);
      gain.connect(this._master);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  /** Low boss-warning rumble */
  playBossWarning() {
    this._init(); this._resume();
    if (!this._enabled || !this._ctx) return;
    const now = this._ctx.currentTime;
    [55, 110, 82.4].forEach((freq, i) => {
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      const t = now + i * 0.3;
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain);
      gain.connect(this._master);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  /** Upgrade selected chime */
  playUpgrade() {
    this._init(); this._resume();
    if (!this._enabled || !this._ctx) return;
    const now = this._ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      const t = now + i * 0.1;
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this._master);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  /** Hit thud */
  playHit() {
    this._init(); this._resume();
    if (!this._enabled || !this._ctx) return;
    const now = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this._master);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

/* ═══════════════════════════════════════════════════════════════
   2. OBJECT POOL
   ═══════════════════════════════════════════════════════════════ */
class ObjectPool {
  constructor(factory, size = 64) {
    this._factory = factory;
    this._pool = [];
    for (let i = 0; i < size; i++) this._pool.push(factory());
  }

  get() {
    return this._pool.length > 0 ? this._pool.pop() : this._factory();
  }

  release(obj) {
    obj.active = false;
    this._pool.push(obj);
  }
}

/* ═══════════════════════════════════════════════════════════════
   3. PARTICLE
   ═══════════════════════════════════════════════════════════════ */
class Particle {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.radius = 3;
    this.life = 0; this.maxLife = 1;
    this.color = '#00ffff';
    this.type = 'spark'; // 'spark' | 'thruster'
  }

  init(x, y, vx, vy, radius, life, color, type = 'spark') {
    this.active = true;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.radius = radius;
    this.life = life; this.maxLife = life;
    this.color = color;
    this.type = type;
    return this;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 20 * dt; // slight gravity effect
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.life -= dt;
    return this.life > 0;
  }

  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════════
   4. BULLET
   ═══════════════════════════════════════════════════════════════ */
class Bullet {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.radius = 4;
    this.damage = 1;
    this.owner = 'player'; // 'player' | 'enemy'
    this.seeking = false;
    this.seekTarget = null;
    this.life = 3; // seconds TTL
    this.color = '#00ffff';
    this.trail = [];
  }

  init(x, y, angle, speed, damage, owner, seeking = false, color = null) {
    this.active = true;
    this.x = x; this.y = y;
    this.vx = Math.sin(angle) * speed;
    this.vy = -Math.cos(angle) * speed;
    this.damage = damage;
    this.owner = owner;
    this.seeking = seeking;
    this.seekTarget = null;
    this.life = 3.5;
    this.trail = [];
    if (color) {
      this.color = color;
    } else {
      this.color = owner === 'player' ? '#00ffff' : '#ff4400';
    }
    if (owner === 'player') {
      this.radius = seeking ? 5 : 3;
    } else {
      this.radius = 3;
    }
    return this;
  }

  update(dt, enemies) {
    // Homing logic
    if (this.seeking && enemies && enemies.length > 0) {
      let closest = null;
      let minDist = Infinity;
      for (const e of enemies) {
        if (!e.active) continue;
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) { minDist = d; closest = e; }
      }
      if (closest) {
        const dx = closest.x - this.x;
        const dy = closest.y - this.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const tx = dx / len * 500;
        const ty = dy / len * 500;
        const turnRate = 3;
        this.vx += (tx - this.vx) * turnRate * dt;
        this.vy += (ty - this.vy) * turnRate * dt;
        // normalize to speed
        const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy) || 1;
        this.vx = this.vx / spd * 500;
        this.vy = this.vy / spd * 500;
      }
    }

    // Trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 5) this.trail.shift();

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    return this.life > 0;
  }

  draw(ctx) {
    // Trail
    for (let i = 0; i < this.trail.length; i++) {
      const alpha = (i / this.trail.length) * 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, this.radius * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Bullet
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════════
   5. POWER-UP
   ═══════════════════════════════════════════════════════════════ */
const POWERUP_TYPES = {
  shield:    { color: '#4488ff', label: '+HP',   duration: 0 },
  double:    { color: '#ffd700', label: '×2',    duration: 10 },
  rapidfire: { color: '#44ff88', label: 'RAPID', duration: 10 },
  spread:    { color: '#cc44ff', label: 'SPREAD',duration: 10 },
};

class PowerUp {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.type = 'shield';
    this.radius = 12;
    this.vy = 60;
    this.life = 8; // disappears after 8 s
    this.pulse = 0;
  }

  init(x, y, type) {
    this.active = true;
    this.x = x; this.y = y;
    this.type = type;
    this.life = 8;
    this.pulse = 0;
    return this;
  }

  update(dt) {
    this.y += this.vy * dt;
    this.life -= dt;
    this.pulse += dt * 4;
    return this.life > 0 && this.active;
  }

  draw(ctx, W, H) {
    if (this.y > H + 20) { this.active = false; return; }
    const info = POWERUP_TYPES[this.type];
    const glow = 8 + Math.sin(this.pulse) * 4;
    ctx.save();
    ctx.shadowBlur = glow;
    ctx.shadowColor = info.color;
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating inner cross
    ctx.translate(this.x, this.y);
    ctx.rotate(this.pulse * 0.5);
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
    ctx.moveTo(0, -6); ctx.lineTo(0, 6);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = info.color;
    ctx.font = 'bold 9px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, this.x, this.y + this.radius + 10);
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════════
   6. SHIP (Player)
   ═══════════════════════════════════════════════════════════════ */
class Ship {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.angle = 0;   // radians, 0 = up
    this.vx = 0; this.vy = 0;
    this.radius = 16;

    // Stats
    this.maxHp = 5;
    this.hp = 5;
    this.speed = 260;       // thrust acceleration px/s^2
    this.maxSpeed = 340;
    this.rotSpeed = 3.2;    // rad/s
    this.fireRate = 0.22;   // seconds between shots
    this.bulletDamage = 1;
    this.bulletSpeed = 620;

    // Upgrades applied
    this.upgrades = {
      speedBoost: 0,
      rapidFire: 0,
      heavyCannon: 0,
      shield: 0,
      tripleShot: false,
      seekerMissile: false,
    };

    // Timers
    this._shootCooldown = 0;
    this._seekerCooldown = 0;
    this._shieldRegenTimer = 0;
    this._invincible = 0;   // seconds of invincibility after hit
    this._thrustOn = false;
    this._thrustParticleTimer = 0;

    // Temporary power-up effects
    this.fx = {
      double: 0,
      rapidfire: 0,
      spread: 0,
    };

    // Shooting flag (for multiplayer sync)
    this.shooting = false;

    // Remote players (drawn differently)
    this.isRemote = false;
    this.remoteName = '';
  }

  applyUpgrade(id) {
    switch (id) {
      case 'speedBoost':
        this.upgrades.speedBoost = Math.min(3, this.upgrades.speedBoost + 1);
        this.speed = 260 * Math.pow(1.15, this.upgrades.speedBoost);
        this.maxSpeed = 340 * Math.pow(1.15, this.upgrades.speedBoost);
        break;
      case 'rapidFire':
        this.upgrades.rapidFire = Math.min(3, this.upgrades.rapidFire + 1);
        this.fireRate = 0.22 / Math.pow(1.25, this.upgrades.rapidFire);
        break;
      case 'heavyCannon':
        this.upgrades.heavyCannon = Math.min(2, this.upgrades.heavyCannon + 1);
        this.bulletDamage = 1 * Math.pow(1.5, this.upgrades.heavyCannon);
        break;
      case 'shield':
        this.upgrades.shield = Math.min(2, this.upgrades.shield + 1);
        if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 1);
        break;
      case 'tripleShot':
        this.upgrades.tripleShot = true;
        break;
      case 'seekerMissile':
        this.upgrades.seekerMissile = true;
        break;
    }
  }

  collectPowerUp(type) {
    switch (type) {
      case 'shield':
        this.hp = Math.min(this.maxHp, this.hp + 1);
        break;
      case 'double':
        this.fx.double = POWERUP_TYPES.double.duration;
        break;
      case 'rapidfire':
        this.fx.rapidfire = POWERUP_TYPES.rapidfire.duration;
        break;
      case 'spread':
        this.fx.spread = POWERUP_TYPES.spread.duration;
        break;
    }
  }

  takeDamage(dmg) {
    if (this._invincible > 0) return false;
    this.hp -= dmg;
    this._invincible = 1.2;
    return true;
  }

  get isAlive() { return this.hp > 0; }

  get scoreMultiplier() { return this.fx.double > 0 ? 2 : 1; }

  update(dt, input, W, H) {
    // Invincibility timer
    if (this._invincible > 0) this._invincible -= dt;

    // Power-up timers
    for (const k of Object.keys(this.fx)) {
      if (this.fx[k] > 0) this.fx[k] -= dt;
    }

    // Shield regen
    if (this.upgrades.shield > 0) {
      this._shieldRegenTimer += dt;
      const regenTime = 10 / this.upgrades.shield;
      if (this._shieldRegenTimer >= regenTime) {
        this._shieldRegenTimer = 0;
        if (this.hp < this.maxHp) this.hp++;
      }
    }

    // Rotate
    if (input.left)  this.angle -= this.rotSpeed * dt;
    if (input.right) this.angle += this.rotSpeed * dt;

    // Thrust
    this._thrustOn = input.up;
    if (input.up) {
      this.vx += Math.sin(this.angle) * this.speed * dt;
      this.vy -= Math.cos(this.angle) * this.speed * dt;
    }

    // Brake
    if (input.down) {
      this.vx *= Math.pow(0.05, dt);
      this.vy *= Math.pow(0.05, dt);
    }

    // Drag
    const drag = 0.985;
    this.vx *= Math.pow(drag, dt * 60);
    this.vy *= Math.pow(drag, dt * 60);

    // Speed cap
    const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (spd > this.maxSpeed) {
      this.vx = this.vx / spd * this.maxSpeed;
      this.vy = this.vy / spd * this.maxSpeed;
    }

    // Move
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Wrap / clamp
    if (this.x < this.radius) { this.x = this.radius; this.vx = 0; }
    if (this.x > W - this.radius) { this.x = W - this.radius; this.vx = 0; }
    if (this.y < this.radius) { this.y = this.radius; this.vy = 0; }
    if (this.y > H - this.radius) { this.y = H - this.radius; this.vy = 0; }

    // Shoot cooldown
    if (this._shootCooldown > 0) this._shootCooldown -= dt;
    if (this._seekerCooldown > 0) this._seekerCooldown -= dt;

    // Thruster particles
    if (this._thrustOn) {
      this._thrustParticleTimer -= dt;
    }

    this.shooting = input.shoot;
  }

  /**
   * Returns array of bullet-init params if firing, else null
   */
  tryShoot() {
    if (!this.shooting) return null;
    const effectiveFR = this.fx.rapidfire > 0 ? this.fireRate * 0.4 : this.fireRate;
    if (this._shootCooldown > 0) return null;
    this._shootCooldown = effectiveFR;

    const bullets = [];
    const useTriple = this.upgrades.tripleShot || this.fx.spread > 0;

    const spd = this.bulletSpeed;
    const dmg = this.bulletDamage;

    if (useTriple) {
      for (const offset of [-0.25, 0, 0.25]) {
        bullets.push({
          x: this.x + Math.sin(this.angle) * 18,
          y: this.y - Math.cos(this.angle) * 18,
          angle: this.angle + offset,
          speed: spd, damage: dmg, owner: 'player', seeking: false
        });
      }
    } else {
      bullets.push({
        x: this.x + Math.sin(this.angle) * 18,
        y: this.y - Math.cos(this.angle) * 18,
        angle: this.angle, speed: spd, damage: dmg, owner: 'player', seeking: false
      });
    }

    // Seeker missile
    if (this.upgrades.seekerMissile && this._seekerCooldown <= 0) {
      this._seekerCooldown = 3;
      bullets.push({
        x: this.x,
        y: this.y,
        angle: this.angle,
        speed: 420, damage: 2, owner: 'player', seeking: true, color: '#ff88ff'
      });
    }

    return bullets;
  }

  /** Thruster particles emitted each frame */
  thrusterParticles(particlePool) {
    if (!this._thrustOn) return;
    this._thrustParticleTimer -= 0.016;
    if (this._thrustParticleTimer > 0) return;
    this._thrustParticleTimer = 0.04;
    const back = this.angle + Math.PI;
    const spread = 0.4;
    for (let i = 0; i < 2; i++) {
      const a = back + (Math.random() - 0.5) * spread;
      const spd = 80 + Math.random() * 120;
      const p = particlePool.get();
      p.init(
        this.x + Math.sin(back) * 14,
        this.y - Math.cos(back) * 14,
        Math.sin(a) * spd,
        -Math.cos(a) * spd,
        2 + Math.random() * 2,
        0.25 + Math.random() * 0.15,
        i % 2 === 0 ? '#00ccff' : '#ff8800',
        'thruster'
      );
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const flash = this._invincible > 0 && Math.sin(this._invincible * 30) > 0;
    const alpha = flash ? 0.4 : 1.0;
    ctx.globalAlpha = alpha;

    // Shield ring
    if (this.upgrades.shield > 0 || this.fx.double > 0) {
      ctx.save();
      ctx.strokeStyle = this.fx.double > 0 ? '#ffd700' : '#4488ff';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Ship body (triangle)
    const c = this.isRemote ? '#ff8800' : '#00ffff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = c;
    ctx.strokeStyle = c;
    ctx.fillStyle = c + '33';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(12, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-12, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Engine glow
    if (this._thrustOn) {
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#ff8800';
      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.moveTo(-6, 8);
      ctx.lineTo(6, 8);
      ctx.lineTo(0, 18 + Math.random() * 6);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // Remote player name tag
    if (this.isRemote && this.remoteName) {
      ctx.save();
      ctx.fillStyle = '#ff8800';
      ctx.font = '11px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.remoteName, this.x, this.y - this.radius - 8);
      ctx.restore();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   7. ENEMY
   ═══════════════════════════════════════════════════════════════ */
class Enemy {
  constructor() {
    this.active = false;
    this.x = 0; this.y = 0;
    this.type = 'drone';  // 'drone' | 'fighter' | 'boss'
    this.hp = 1; this.maxHp = 1;
    this.radius = 14;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.shootTimer = 0;
    this.shootInterval = 2.5;
    this.sinePhase = 0;
    this.bossPattern = 0;
    this.bossTimer = 0;
    this.spiralAngle = 0;
    this.points = 100;
    this.id = 0; // unique id for multiplayer
    this._spawnY = -50;
  }

  init(x, y, type, wave, id) {
    this.active = true;
    this.x = x; this.y = y;
    this.type = type;
    this.id = id;
    this.sinePhase = Math.random() * Math.PI * 2;
    this.shootTimer = Math.random() * 2;
    this.bossPattern = 0;
    this.bossTimer = 0;
    this.spiralAngle = 0;
    this.angle = 0;
    this._spawnY = y;

    switch (type) {
      case 'drone':
        this.hp = this.maxHp = 1;
        this.radius = 14;
        this.vx = 0;
        this.vy = 55 + wave * 4;
        this.shootInterval = 3.5 - Math.min(wave * 0.1, 1.5);
        this.points = 100;
        break;
      case 'fighter':
        this.hp = this.maxHp = 2;
        this.radius = 16;
        this.vy = 45 + wave * 3;
        this.vx = 0;
        this.shootInterval = 2 - Math.min(wave * 0.08, 1);
        this.points = 250;
        break;
      case 'boss':
        this.hp = this.maxHp = 20 + (Math.floor(wave / 5) - 1) * 10;
        this.radius = 44;
        this.vy = 30;
        this.vx = 60;
        this.shootInterval = 0.9;
        this.points = 2000;
        break;
    }
    return this;
  }

  update(dt, targetX, targetY, W, H) {
    if (!this.active) return null;
    this.shootTimer -= dt;

    switch (this.type) {
      case 'drone':
        this.y += this.vy * dt;
        break;

      case 'fighter':
        this.sinePhase += dt * 2.2;
        this.x += Math.sin(this.sinePhase) * 120 * dt;
        this.y += this.vy * dt;
        // Bounce off edges
        if (this.x < this.radius) this.x = this.radius;
        if (this.x > W - this.radius) this.x = W - this.radius;
        break;

      case 'boss':
        // Boss phases
        this.bossTimer += dt;
        this.spiralAngle += dt * 2;

        if (this.bossTimer > 8) {
          this.bossTimer = 0;
          this.bossPattern = (this.bossPattern + 1) % 3;
        }

        // Move across top
        this.x += this.vx * dt;
        if (this.x > W - this.radius) { this.x = W - this.radius; this.vx = -Math.abs(this.vx); }
        if (this.x < this.radius)     { this.x = this.radius;     this.vx = Math.abs(this.vx); }

        // Slowly descend then hover
        if (this.y < 120) this.y += this.vy * dt;
        break;
    }

    // Off-screen (bottom) = remove
    if (this.y > H + this.radius) {
      this.active = false;
    }

    // Try to shoot
    if (this.shootTimer <= 0) {
      this.shootTimer = this.shootInterval * (0.8 + Math.random() * 0.4);
      return this._buildShots(targetX, targetY);
    }
    return null;
  }

  _buildShots(targetX, targetY) {
    const shots = [];
    const baseSpeed = 280;

    const aimed = () => {
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const angle = Math.atan2(dx, -dy);
      shots.push({ x: this.x, y: this.y + this.radius, angle, speed: baseSpeed, damage: 1, owner: 'enemy' });
    };

    switch (this.type) {
      case 'drone':
        shots.push({ x: this.x, y: this.y + this.radius, angle: 0, speed: baseSpeed * 0.85, damage: 1, owner: 'enemy' });
        break;
      case 'fighter':
        aimed();
        break;
      case 'boss':
        switch (this.bossPattern) {
          case 0: // spiral
            for (let i = 0; i < 6; i++) {
              const a = this.spiralAngle + (i / 6) * Math.PI * 2;
              shots.push({ x: this.x, y: this.y, angle: a, speed: baseSpeed * 0.8, damage: 1, owner: 'enemy' });
            }
            break;
          case 1: // aimed triple
            aimed();
            const baseAngle = Math.atan2(targetX - this.x, -(targetY - this.y));
            shots.push({ x: this.x, y: this.y, angle: baseAngle - 0.3, speed: baseSpeed, damage: 1, owner: 'enemy' });
            shots.push({ x: this.x, y: this.y, angle: baseAngle + 0.3, speed: baseSpeed, damage: 1, owner: 'enemy' });
            break;
          case 2: // spread fan
            for (let i = -2; i <= 2; i++) {
              shots.push({ x: this.x, y: this.y + this.radius, angle: i * 0.35, speed: baseSpeed * 0.9, damage: 1, owner: 'enemy' });
            }
            break;
        }
        break;
    }
    return shots;
  }

  takeDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.active = false;
      return true; // dead
    }
    return false;
  }

  draw(ctx) {
    if (!this.active) return;
    ctx.save();
    ctx.translate(this.x, this.y);

    switch (this.type) {
      case 'drone':
        this._drawDrone(ctx);
        break;
      case 'fighter':
        this._drawFighter(ctx);
        break;
      case 'boss':
        this._drawBoss(ctx);
        break;
    }

    // HP bar for boss / fighter
    if (this.type !== 'drone') {
      const barW = this.type === 'boss' ? 80 : 28;
      const pct = this.hp / this.maxHp;
      ctx.fillStyle = '#333';
      ctx.fillRect(-barW / 2, this.radius + 4, barW, 5);
      const hpColor = pct > 0.5 ? '#44ff44' : pct > 0.25 ? '#ffaa00' : '#ff2222';
      ctx.fillStyle = hpColor;
      ctx.fillRect(-barW / 2, this.radius + 4, barW * pct, 5);
    }

    ctx.restore();
  }

  _drawDrone(ctx) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ff4400';
    ctx.strokeStyle = '#ff4400';
    ctx.fillStyle = '#ff440022';
    ctx.lineWidth = 1.5;
    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(10, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Center dot
    ctx.fillStyle = '#ff8844';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFighter(ctx) {
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff6600';
    ctx.strokeStyle = '#ff6600';
    ctx.fillStyle = '#ff660022';
    ctx.lineWidth = 2;
    // Arrow shape
    ctx.beginPath();
    ctx.moveTo(0, 14);   // nose (pointing down, towards player)
    ctx.lineTo(14, -10);
    ctx.lineTo(5, -4);
    ctx.lineTo(0, -8);
    ctx.lineTo(-5, -4);
    ctx.lineTo(-14, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cockpit
    ctx.fillStyle = '#ffaa44';
    ctx.beginPath();
    ctx.arc(0, 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawBoss(ctx) {
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff2200';
    ctx.strokeStyle = '#ff2200';
    ctx.fillStyle = '#cc110033';
    ctx.lineWidth = 3;

    // Outer hull hexagon-ish
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 42 : 32;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating detail
    ctx.rotate(Date.now() * 0.001);
    ctx.strokeStyle = '#ff4400';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
      ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
      ctx.stroke();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   8. WAVE MANAGER
   ═══════════════════════════════════════════════════════════════ */
class WaveManager {
  constructor() {
    this.wave = 0;
    this.enemiesRemaining = 0;
    this.state = 'idle'; // 'idle' | 'spawning' | 'fighting' | 'complete' | 'boss_warning'
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._spawnInterval = 1.2;
    this._pauseTimer = 0;
    this._bossWarned = false;
    this._nextEnemyId = 1;
  }

  nextWave(W) {
    this.wave++;
    this._bossWarned = false;
    this.state = 'boss_warning';
    this._pauseTimer = this.wave % 5 === 0 ? 3.5 : 1.5;
    this._buildSpawnQueue(W);
  }

  _buildSpawnQueue(W) {
    this._spawnQueue = [];
    const w = this.wave;

    if (w % 5 === 0) {
      // Boss wave
      this._spawnQueue.push({ type: 'boss', x: W / 2, y: -80 });
      // A few drone escorts
      for (let i = 0; i < 3 + Math.floor(w / 5); i++) {
        this._spawnQueue.push({ type: 'drone', x: 80 + Math.random() * (W - 160), y: -50 - i * 40 });
      }
    } else {
      const droneCount = 3 + w * 2;
      const fighterCount = w >= 6 ? Math.floor((w - 5) * 1.5) : 0;

      for (let i = 0; i < droneCount; i++) {
        this._spawnQueue.push({ type: 'drone', x: 60 + Math.random() * (W - 120), y: -50 - Math.random() * 300 });
      }
      for (let i = 0; i < fighterCount; i++) {
        this._spawnQueue.push({ type: 'fighter', x: 60 + Math.random() * (W - 120), y: -80 - Math.random() * 200 });
      }
      // Shuffle
      for (let i = this._spawnQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this._spawnQueue[i], this._spawnQueue[j]] = [this._spawnQueue[j], this._spawnQueue[i]];
      }
    }

    this.enemiesRemaining = this._spawnQueue.length;
  }

  update(dt, enemies, W, onWaveComplete) {
    if (this.state === 'idle') return;

    if (this.state === 'boss_warning') {
      this._pauseTimer -= dt;
      if (this._pauseTimer <= 0) {
        this.state = 'spawning';
        this._spawnTimer = 0;
      }
      return;
    }

    if (this.state === 'spawning') {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0 && this._spawnQueue.length > 0) {
        const info = this._spawnQueue.shift();
        const e = enemies.find(en => !en.active) || new Enemy();
        e.init(info.x, info.y, info.type, this.wave, this._nextEnemyId++);
        if (!enemies.includes(e)) enemies.push(e);
        this._spawnTimer = this._spawnInterval * (0.6 + Math.random() * 0.8);
      }
      if (this._spawnQueue.length === 0) {
        this.state = 'fighting';
      }
    }

    if (this.state === 'fighting' || this.state === 'spawning') {
      const alive = enemies.filter(e => e.active).length;
      if (alive === 0 && this._spawnQueue.length === 0) {
        this.state = 'complete';
        if (onWaveComplete) onWaveComplete(this.wave);
      }
    }
  }

  get isBossWave() { return this.wave % 5 === 0; }
}

/* ═══════════════════════════════════════════════════════════════
   9. UPGRADE SYSTEM
   ═══════════════════════════════════════════════════════════════ */
const ALL_UPGRADES = [
  { id: 'speedBoost',   label: 'Speed Boost',    max: 3, desc: '+15% movement speed per level',    icon: '⚡' },
  { id: 'rapidFire',    label: 'Rapid Fire',      max: 3, desc: '+25% fire rate per level',         icon: '🔥' },
  { id: 'heavyCannon',  label: 'Heavy Cannon',    max: 2, desc: 'Bullet damage ×1.5 per level',     icon: '💥' },
  { id: 'shield',       label: 'Shield',          max: 2, desc: 'Regen 1 HP per 10s, +1 HP now',    icon: '🛡️' },
  { id: 'tripleShot',   label: 'Triple Shot',     max: 1, desc: 'Fire 3 bullets spread',            icon: '✨' },
  { id: 'seekerMissile',label: 'Seeker Missile',  max: 1, desc: 'Homing missile every 3 seconds',   icon: '🚀' },
];

class UpgradeSystem {
  constructor() {
    this.pendingPoints = 0;
    this.choices = [];
    this.visible = false;
    this._selected = -1;
  }

  offerUpgrades(ship) {
    this.pendingPoints++;
    this.choices = this._generateChoices(ship);
    this.visible = this.choices.length > 0;
    this._selected = -1;
  }

  _generateChoices(ship) {
    const available = ALL_UPGRADES.filter(u => {
      const current = ship.upgrades[u.id];
      if (typeof current === 'boolean') return !current;
      return (current || 0) < u.max;
    });

    // Pick 3 random (or fewer if not enough available)
    const shuffled = available.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, shuffled.length));
  }

  selectUpgrade(index, ship) {
    if (index < 0 || index >= this.choices.length) return;
    const upgrade = this.choices[index];
    ship.applyUpgrade(upgrade.id);
    this.pendingPoints--;
    this.visible = false;
    this.choices = [];
    return upgrade;
  }

  /** Render upgrade modal overlay */
  drawModal(ctx, W, H, waveJustCompleted) {
    if (!this.visible) return;

    // Darken background
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,20,0.82)';
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#ffd700';
    ctx.fillText('UPGRADE YOUR SHIP', W / 2, H / 2 - 160);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#aaaacc';
    ctx.font = '13px Orbitron, sans-serif';
    ctx.fillText('Choose 1 upgrade', W / 2, H / 2 - 130);

    // Cards
    const cardW = Math.min(200, (W - 80) / 3);
    const cardH = 150;
    const totalW = this.choices.length * cardW + (this.choices.length - 1) * 20;
    const startX = W / 2 - totalW / 2;

    this.choices.forEach((u, i) => {
      const cx = startX + i * (cardW + 20);
      const cy = H / 2 - 90;
      const hover = this._selected === i;

      ctx.fillStyle = hover ? 'rgba(255,215,0,0.18)' : 'rgba(0,40,80,0.8)';
      ctx.strokeStyle = hover ? '#ffd700' : '#4488ff';
      ctx.lineWidth = hover ? 2.5 : 1.5;
      ctx.shadowBlur = hover ? 16 : 4;
      ctx.shadowColor = hover ? '#ffd700' : '#4488ff';

      // Rounded rect
      const r = 10;
      ctx.beginPath();
      ctx.moveTo(cx + r, cy);
      ctx.lineTo(cx + cardW - r, cy);
      ctx.quadraticCurveTo(cx + cardW, cy, cx + cardW, cy + r);
      ctx.lineTo(cx + cardW, cy + cardH - r);
      ctx.quadraticCurveTo(cx + cardW, cy + cardH, cx + cardW - r, cy + cardH);
      ctx.lineTo(cx + r, cy + cardH);
      ctx.quadraticCurveTo(cx, cy + cardH, cx, cy + cardH - r);
      ctx.lineTo(cx, cy + r);
      ctx.quadraticCurveTo(cx, cy, cx + r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Icon
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(u.icon, cx + cardW / 2, cy + 38);

      // Label
      ctx.fillStyle = hover ? '#ffd700' : '#00ffff';
      ctx.font = 'bold 12px Orbitron, sans-serif';
      ctx.fillText(u.label, cx + cardW / 2, cy + 68);

      // Desc
      ctx.fillStyle = '#aaaacc';
      ctx.font = '10px Exo 2, sans-serif';
      const words = u.desc.split(' ');
      let line = '';
      let lineY = cy + 88;
      for (const word of words) {
        const test = line + (line ? ' ' : '') + word;
        if (ctx.measureText(test).width > cardW - 20 && line) {
          ctx.fillText(line, cx + cardW / 2, lineY);
          line = word;
          lineY += 16;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, cx + cardW / 2, lineY);

      // Key hint
      ctx.fillStyle = '#ffd700';
      ctx.font = '11px Orbitron, sans-serif';
      ctx.fillText(`[${i + 1}]`, cx + cardW / 2, cy + cardH - 10);
    });

    ctx.restore();
  }

  setHover(index) { this._selected = index; }

  handleClick(mx, my, W, H, ship) {
    if (!this.visible) return null;
    const cardW = Math.min(200, (W - 80) / 3);
    const cardH = 150;
    const totalW = this.choices.length * cardW + (this.choices.length - 1) * 20;
    const startX = W / 2 - totalW / 2;
    const cy = H / 2 - 90;

    for (let i = 0; i < this.choices.length; i++) {
      const cx = startX + i * (cardW + 20);
      if (mx >= cx && mx <= cx + cardW && my >= cy && my <= cy + cardH) {
        return this.selectUpgrade(i, ship);
      }
    }
    return null;
  }

  handleHover(mx, my, W, H) {
    if (!this.visible) return;
    const cardW = Math.min(200, (W - 80) / 3);
    const cardH = 150;
    const totalW = this.choices.length * cardW + (this.choices.length - 1) * 20;
    const startX = W / 2 - totalW / 2;
    const cy = H / 2 - 90;

    let found = -1;
    for (let i = 0; i < this.choices.length; i++) {
      const cx = startX + i * (cardW + 20);
      if (mx >= cx && mx <= cx + cardW && my >= cy && my <= cy + cardH) {
        found = i; break;
      }
    }
    this._selected = found;
  }
}

/* ═══════════════════════════════════════════════════════════════
   10. LEADERBOARD
   ═══════════════════════════════════════════════════════════════ */
const LEADERBOARD_KEY = 'fedya_space_leaderboard';

class Leaderboard {
  load() {
    try {
      return JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
    } catch { return []; }
  }

  save(entries) {
    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
    } catch {}
  }

  addEntry(name, score, wave, mode) {
    const entries = this.load();
    entries.push({ name: name || 'PILOT', score, wave, mode, date: new Date().toISOString().slice(0, 10) });
    entries.sort((a, b) => b.score - a.score);
    const top10 = entries.slice(0, 10);
    this.save(top10);
    return top10;
  }

  isHighScore(score) {
    const entries = this.load();
    if (entries.length < 10) return true;
    return score > entries[entries.length - 1].score;
  }

  getTop10() { return this.load(); }
}

/* ═══════════════════════════════════════════════════════════════
   11. UI RENDERER
   ═══════════════════════════════════════════════════════════════ */
class UIRenderer {
  constructor(ctx, W, H) {
    this.ctx = ctx;
    this.W = W;
    this.H = H;
  }

  resize(W, H) { this.W = W; this.H = H; }

  drawHUD(ship, score, wave, multiplier, waveState) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.save();

    // Score
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 18px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ffff';
    ctx.fillText(`SCORE: ${score.toLocaleString()}`, 16, 28);
    ctx.shadowBlur = 0;

    // Wave
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px Orbitron, sans-serif';
    ctx.fillText(`WAVE ${wave}`, W / 2, 24);

    // Multiplier
    if (multiplier > 1) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 14px Orbitron, sans-serif';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ffd700';
      ctx.fillText(`×${multiplier} SCORE!`, W / 2, 44);
      ctx.shadowBlur = 0;
    }

    // HP bar
    const hpBarX = 16;
    const hpBarY = H - 32;
    const hpBarW = 140;
    const hpBarH = 14;
    ctx.fillStyle = '#111133';
    ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
    const hpPct = Math.max(0, ship.hp / ship.maxHp);
    const hpColor = hpPct > 0.6 ? '#44ff88' : hpPct > 0.3 ? '#ffaa00' : '#ff3333';
    ctx.fillStyle = hpColor;
    ctx.fillRect(hpBarX, hpBarY, hpBarW * hpPct, hpBarH);
    ctx.strokeStyle = '#4466aa';
    ctx.lineWidth = 1;
    ctx.strokeRect(hpBarX, hpBarY, hpBarW, hpBarH);
    ctx.fillStyle = '#aaccff';
    ctx.font = '10px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${ship.hp}/${ship.maxHp}`, hpBarX + 4, hpBarY + 11);

    // Power-up indicators
    let puxOffset = 0;
    const drawFX = (label, color) => {
      ctx.fillStyle = color;
      ctx.font = 'bold 10px Orbitron, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, 16 + puxOffset, H - 48);
      puxOffset += ctx.measureText(label).width + 12;
    };
    if (ship.fx.double > 0)    drawFX(`×2 ${ship.fx.double.toFixed(1)}s`, '#ffd700');
    if (ship.fx.rapidfire > 0) drawFX(`RAPID ${ship.fx.rapidfire.toFixed(1)}s`, '#44ff88');
    if (ship.fx.spread > 0)    drawFX(`SPREAD ${ship.fx.spread.toFixed(1)}s`, '#cc88ff');

    // Wave state message
    if (waveState === 'boss_warning') {
      ctx.save();
      ctx.fillStyle = `rgba(255,0,0,${0.6 + 0.4 * Math.sin(Date.now() * 0.006)})`;
      ctx.font = 'bold 28px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ff0000';
      ctx.fillText('⚠ BOSS INCOMING ⚠', W / 2, H / 2);
      ctx.restore();
    }

    ctx.restore();
  }

  drawStartScreen(leaderboard, playerName) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.save();

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,15,0.95)';
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 32px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ffff';
    ctx.fillText('GALAXY EXPLORER', W / 2, 70);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px Orbitron, sans-serif';
    ctx.fillText('SPACE SHOOTER', W / 2, 98);

    // Instructions
    ctx.fillStyle = '#8899bb';
    ctx.font = '11px Orbitron, sans-serif';
    ctx.fillText('WASD / ARROWS to move   SPACE to shoot   P to pause', W / 2, 126);

    // Leaderboard
    const entries = leaderboard.getTop10();
    const lbX = W / 2 - 160;
    const lbY = 148;
    const lbW = 320;
    const lbH = Math.min(entries.length * 22 + 46, 270);

    ctx.fillStyle = 'rgba(0,10,40,0.8)';
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(lbX, lbY, lbW, lbH);
    ctx.strokeRect(lbX, lbY, lbW, lbH);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 13px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HIGH SCORES', W / 2, lbY + 20);

    if (entries.length === 0) {
      ctx.fillStyle = '#556677';
      ctx.font = '11px Orbitron, sans-serif';
      ctx.fillText('No scores yet — be the first!', W / 2, lbY + 50);
    } else {
      entries.slice(0, 10).forEach((e, i) => {
        const ey = lbY + 42 + i * 22;
        if (ey > lbY + lbH - 10) return;
        const rankColors = ['#ffd700', '#aaaaaa', '#cd7f32'];
        ctx.fillStyle = rankColors[i] || '#8899bb';
        ctx.font = i < 3 ? 'bold 11px Orbitron, sans-serif' : '11px Orbitron, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${i + 1}. ${e.name.slice(0, 10).padEnd(10)}`, lbX + 12, ey);
        ctx.textAlign = 'right';
        ctx.fillText(`${e.score.toLocaleString()}  W${e.wave}`, lbX + lbW - 12, ey);
      });
    }

    // Start prompt
    ctx.fillStyle = `rgba(0,255,255,${0.6 + 0.4 * Math.sin(Date.now() * 0.004)})`;
    ctx.font = 'bold 16px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';
    ctx.fillText('PRESS ENTER OR TAP TO START', W / 2, H - 60);
    ctx.shadowBlur = 0;

    // Player name
    if (playerName !== undefined) {
      ctx.fillStyle = '#aaccff';
      ctx.font = '12px Orbitron, sans-serif';
      ctx.fillText(`PILOT: ${playerName || '???'}`, W / 2, H - 34);
    }

    ctx.restore();
  }

  drawCountdown(count) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,15,0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 96px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#ffd700';
    ctx.fillText(count === 0 ? 'GO!' : count, W / 2, H / 2 + 32);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawWaveComplete(wave, score) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,15,0.65)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 28px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ffd700';
    ctx.fillText(`WAVE ${wave} COMPLETE`, W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00ffff';
    ctx.font = '16px Orbitron, sans-serif';
    ctx.fillText(`+${(wave * 500).toLocaleString()} BONUS`, W / 2, H / 2 + 10);
    ctx.fillStyle = '#aaccff';
    ctx.font = '13px Orbitron, sans-serif';
    ctx.fillText('Preparing upgrade shop...', W / 2, H / 2 + 40);
    ctx.restore();
  }

  drawPaused() {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,15,0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 36px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ffd700';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaccff';
    ctx.font = '14px Orbitron, sans-serif';
    ctx.fillText('Press P to resume', W / 2, H / 2 + 36);
    ctx.restore();
  }

  drawGameOver(score, wave, name, leaderboard) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,10,0.92)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ff2222';
    ctx.font = 'bold 40px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#ff2222';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 110);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px Orbitron, sans-serif';
    ctx.fillText(`SCORE: ${score.toLocaleString()}`, W / 2, H / 2 - 68);

    ctx.fillStyle = '#aaccff';
    ctx.font = '14px Orbitron, sans-serif';
    ctx.fillText(`WAVE REACHED: ${wave}`, W / 2, H / 2 - 38);
    ctx.fillText(`PILOT: ${name}`, W / 2, H / 2 - 14);

    // Top scores
    const entries = leaderboard.getTop10();
    if (entries.length > 0) {
      ctx.fillStyle = '#556688';
      ctx.font = '11px Orbitron, sans-serif';
      ctx.fillText('TOP SCORES', W / 2, H / 2 + 20);
      entries.slice(0, 5).forEach((e, i) => {
        ctx.fillStyle = i === 0 ? '#ffd700' : '#8899bb';
        ctx.font = '11px Orbitron, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${i + 1}. ${e.name.slice(0, 10)}`, W / 2 - 100, H / 2 + 42 + i * 20);
        ctx.textAlign = 'right';
        ctx.fillText(e.score.toLocaleString(), W / 2 + 100, H / 2 + 42 + i * 20);
      });
    }

    ctx.fillStyle = `rgba(0,255,255,${0.6 + 0.4 * Math.sin(Date.now() * 0.004)})`;
    ctx.font = 'bold 14px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ffff';
    ctx.fillText('PRESS ENTER OR TAP TO PLAY AGAIN', W / 2, H - 40);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawRemotePlayer(ctx, remoteShip) {
    // Delegated to the Ship.draw()
    remoteShip.draw(ctx);
  }
}

/* ═══════════════════════════════════════════════════════════════
   12. TOUCH CONTROLS
   ═══════════════════════════════════════════════════════════════ */
class TouchControls {
  constructor(canvas) {
    this._canvas = canvas;
    this._joystickActive = false;
    this._joystickBase = { x: 0, y: 0 };
    this._joystickPos = { x: 0, y: 0 };
    this._joystickId = null;
    this._shootId = null;
    this.input = { up: false, down: false, left: false, right: false, shoot: false };
    this._visible = false;
    this._setupEvents();
  }

  _setupEvents() {
    const c = this._canvas;
    c.addEventListener('touchstart', e => this._onStart(e), { passive: false });
    c.addEventListener('touchmove',  e => this._onMove(e),  { passive: false });
    c.addEventListener('touchend',   e => this._onEnd(e),   { passive: false });
    c.addEventListener('touchcancel',e => this._onEnd(e),   { passive: false });
  }

  _getPos(touch) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (touch.clientX - rect.left) * (this._canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (this._canvas.height / rect.height),
    };
  }

  _onStart(e) {
    e.preventDefault();
    this._visible = true;
    const W = this._canvas.width;
    for (const touch of e.changedTouches) {
      const pos = this._getPos(touch);
      if (pos.x < W / 2 && this._joystickId === null) {
        this._joystickId = touch.identifier;
        this._joystickBase = { ...pos };
        this._joystickPos = { ...pos };
        this._joystickActive = true;
      } else if (pos.x >= W / 2 && this._shootId === null) {
        this._shootId = touch.identifier;
        this.input.shoot = true;
      }
    }
    this._updateJoystickInput();
  }

  _onMove(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._joystickId) {
        this._joystickPos = this._getPos(touch);
      }
    }
    this._updateJoystickInput();
  }

  _onEnd(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === this._joystickId) {
        this._joystickId = null;
        this._joystickActive = false;
        this._joystickPos = { ...this._joystickBase };
        this.input.up = false; this.input.down = false;
        this.input.left = false; this.input.right = false;
      }
      if (touch.identifier === this._shootId) {
        this._shootId = null;
        this.input.shoot = false;
      }
    }
  }

  _updateJoystickInput() {
    if (!this._joystickActive) return;
    const dx = this._joystickPos.x - this._joystickBase.x;
    const dy = this._joystickPos.y - this._joystickBase.y;
    const deadzone = 12;
    this.input.left  = dx < -deadzone;
    this.input.right = dx >  deadzone;
    this.input.up    = dy < -deadzone;
    this.input.down  = dy >  deadzone;
  }

  draw(ctx) {
    if (!this._visible || !this._joystickActive) return;
    ctx.save();
    const base = this._joystickBase;
    const pos  = this._joystickPos;
    const R = 48, r = 22;

    // Base ring
    ctx.strokeStyle = 'rgba(0,200,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(base.x, base.y, R, 0, Math.PI * 2);
    ctx.stroke();

    // Thumb
    ctx.fillStyle = 'rgba(0,200,255,0.45)';
    ctx.strokeStyle = 'rgba(0,200,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Shoot button hint
    ctx.fillStyle = 'rgba(255,100,0,0.25)';
    ctx.strokeStyle = 'rgba(255,100,0,0.6)';
    ctx.lineWidth = 2;
    const W = this._canvas.width;
    const H = this._canvas.height;
    ctx.beginPath();
    ctx.arc(W * 0.8, H * 0.75, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,180,50,0.85)';
    ctx.font = 'bold 13px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FIRE', W * 0.8, H * 0.75);
    ctx.textBaseline = 'alphabetic';

    ctx.restore();
  }

  drawShootButton(ctx) {
    // Static shoot button (always visible on touch devices)
    if (!('ontouchstart' in window)) return;
    const W = this._canvas.width;
    const H = this._canvas.height;
    ctx.save();
    const alpha = this._shootId !== null ? 0.7 : 0.3;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,100,0,0.4)';
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W * 0.8, H * 0.75, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffcc44';
    ctx.font = 'bold 13px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FIRE', W * 0.8, H * 0.75);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════════
   13. SPACE GAME — MAIN CLASS
   ═══════════════════════════════════════════════════════════════ */
class SpaceGame {
  constructor(canvasId, options = {}) {
    this._canvasId = canvasId;
    this._options = Object.assign({
      showStartScreen: true,
    }, options);

    this._canvas = null;
    this._ctx = null;
    this._animId = null;
    this._lastTime = 0;

    // Core systems
    this._audio = new AudioEngine();
    this._leaderboard = new Leaderboard();
    this._waveManager = new WaveManager();
    this._upgradeSystem = new UpgradeSystem();
    this._ui = null;
    this._touch = null;

    // Entity collections
    this._ship = null;
    this._enemies = [];
    this._bullets = [];
    this._particles = [];
    this._powerUps = [];

    // Object pools
    this._bulletPool = new ObjectPool(() => new Bullet(), 128);
    this._particlePool = new ObjectPool(() => new Particle(), 256);

    // Multiplayer
    this._mpClient = null;
    this._remotePlayers = {};   // playerId -> Ship
    this._mode = 'single';

    // Game state
    this._state = 'start'; // 'start' | 'countdown' | 'playing' | 'paused' | 'wave_complete' | 'upgrade' | 'gameover'
    this._score = 0;
    this._playerName = '';
    this._countdownVal = 3;
    this._countdownTimer = 0;
    this._waveCompleteTimer = 0;

    // Keyboard input
    this._keys = {};
    this._input = { up: false, down: false, left: false, right: false, shoot: false };

    // Event system
    this._handlers = {};

    // Unique enemy ID counter (shared with WaveManager)
    this._nextEnemyId = 1;

    this._init();
  }

  /* ─── EVENT SYSTEM ─────────────────────────────────────────── */
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
  }

  off(event, handler) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== handler);
  }

  emit(event, data) {
    if (!this._handlers[event]) return;
    for (const h of this._handlers[event]) {
      try { h(data); } catch (e) { console.error('SpaceGame event handler error:', e); }
    }
  }

  /* ─── PUBLIC API ────────────────────────────────────────────── */
  start(playerName, mode = 'single') {
    this._playerName = playerName || 'PILOT';
    this._mode = mode;
    this._resetGame();
    this._startCountdown();
  }

  pause() {
    if (this._state === 'playing') {
      this._state = 'paused';
      this.emit('game:paused', {});
    }
  }

  resume() {
    if (this._state === 'paused') {
      this._state = 'playing';
      this._lastTime = performance.now();
      this.emit('game:resumed', {});
    }
  }

  destroy() {
    if (this._animId) cancelAnimationFrame(this._animId);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);
    this._handlers = {};
  }

  getLocalPlayerState() {
    if (!this._ship) return null;
    return {
      x: this._ship.x,
      y: this._ship.y,
      angle: this._ship.angle,
      vx: this._ship.vx,
      vy: this._ship.vy,
      hp: this._ship.hp,
      shooting: this._ship.shooting,
    };
  }

  applyRemotePlayerState(playerId, state) {
    const rs = this._remotePlayers[playerId];
    if (!rs) return;
    // Smooth interpolation
    rs.x = state.x !== undefined ? state.x : rs.x;
    rs.y = state.y !== undefined ? state.y : rs.y;
    rs.angle = state.angle !== undefined ? state.angle : rs.angle;
    rs.vx = state.vx !== undefined ? state.vx : rs.vx;
    rs.vy = state.vy !== undefined ? state.vy : rs.vy;
    rs.hp = state.hp !== undefined ? state.hp : rs.hp;
  }

  spawnRemoteEnemy(enemyData) {
    const e = new Enemy();
    e.init(enemyData.x, enemyData.y, enemyData.type, enemyData.wave || this._waveManager.wave, enemyData.id || this._nextEnemyId++);
    this._enemies.push(e);
  }

  syncScore(playerId, score) {
    // In multiplayer: update HUD display for remote player score
    // stored in remotePlayers metadata
    if (this._remotePlayers[playerId]) {
      this._remotePlayers[playerId]._remoteScore = score;
    }
  }

  setMultiplayerMode(mpClient) {
    this._mpClient = mpClient;
    this._mode = 'multi';
  }

  addRemotePlayer(playerId, name) {
    const rs = new Ship(this._canvas ? this._canvas.width / 2 : 200, 200);
    rs.isRemote = true;
    rs.remoteName = name || playerId;
    this._remotePlayers[playerId] = rs;
  }

  removeRemotePlayer(playerId) {
    delete this._remotePlayers[playerId];
  }

  /* ─── INTERNAL INIT ─────────────────────────────────────────── */
  _init() {
    this._canvas = document.getElementById(this._canvasId);
    if (!this._canvas) {
      console.error(`SpaceGame: canvas #${this._canvasId} not found`);
      return;
    }
    this._ctx = this._canvas.getContext('2d');
    this._resizeCanvas();

    this._ui = new UIRenderer(this._ctx, this._canvas.width, this._canvas.height);
    this._touch = new TouchControls(this._canvas);

    // Bind events
    this._onKeyDown = e => this._handleKeyDown(e);
    this._onKeyUp   = e => this._handleKeyUp(e);
    this._onResize  = () => this._resizeCanvas();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
    window.addEventListener('resize',  this._onResize);

    // Mouse events for upgrade screen
    this._canvas.addEventListener('mousemove', e => this._handleMouseMove(e));
    this._canvas.addEventListener('click',     e => this._handleClick(e));

    // Start loop
    this._animId = requestAnimationFrame(ts => this._loop(ts));

    this.emit('game:ready', {});
  }

  _isCanvasVisible() {
    if (!this._canvas) return false;
    const rect = this._canvas.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight &&
           rect.right > 0  && rect.left < window.innerWidth;
  }

  _resizeCanvas() {
    if (!this._canvas) return;
    const parent = this._canvas.parentElement || document.body;
    const w = parent.clientWidth  || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this._canvas.width  = w;
    this._canvas.height = h;
    if (this._ui) this._ui.resize(w, h);
  }

  /* ─── GAME RESET ────────────────────────────────────────────── */
  _resetGame() {
    const W = this._canvas.width;
    const H = this._canvas.height;

    this._ship = new Ship(W / 2, H - 100);
    this._enemies = [];
    this._bullets = [];
    this._particles = [];
    this._powerUps = [];
    this._score = 0;
    this._waveManager.wave = 0;
    this._waveManager.state = 'idle';
    this._upgradeSystem.visible = false;
    this._upgradeSystem.pendingPoints = 0;
  }

  _startCountdown() {
    this._state = 'countdown';
    this._countdownVal = 3;
    this._countdownTimer = 1.0;
  }

  _startWave() {
    this._waveManager.nextWave(this._canvas.width);
    this.emit('wave:start', { waveNumber: this._waveManager.wave });
    if (this._waveManager.isBossWave) {
      this._audio.playBossWarning();
    }
  }

  /* ─── MAIN LOOP ─────────────────────────────────────────────── */
  _loop(timestamp) {
    this._animId = requestAnimationFrame(ts => this._loop(ts));

    let dt = (timestamp - this._lastTime) / 1000;
    this._lastTime = timestamp;
    // Cap delta to avoid spiral of death on tab switch
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;

    const ctx = this._ctx;
    const W = this._canvas.width;
    const H = this._canvas.height;

    // Clear
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, W, H);

    switch (this._state) {
      case 'start':
        this._ui.drawStartScreen(this._leaderboard, this._playerName);
        this._touch.drawShootButton(ctx);
        break;

      case 'countdown':
        this._tickCountdown(dt, ctx, W, H);
        break;

      case 'playing':
        this._tickGame(dt, ctx, W, H);
        break;

      case 'paused':
        this._drawScene(ctx, W, H);
        this._ui.drawPaused();
        break;

      case 'wave_complete':
        this._drawScene(ctx, W, H);
        this._waveCompleteTimer -= dt;
        this._ui.drawWaveComplete(this._waveManager.wave, this._score);
        if (this._waveCompleteTimer <= 0) {
          this._upgradeSystem.offerUpgrades(this._ship);
          if (this._upgradeSystem.visible) {
            this._state = 'upgrade';
          } else {
            this._startWave();
            this._state = 'playing';
          }
        }
        break;

      case 'upgrade':
        this._drawScene(ctx, W, H);
        this._upgradeSystem.drawModal(ctx, W, H, this._waveManager.wave);
        break;

      case 'gameover':
        this._drawParticles(ctx);
        this._ui.drawGameOver(this._score, this._waveManager.wave, this._playerName, this._leaderboard);
        this._touch.drawShootButton(ctx);
        break;
    }
  }

  _tickCountdown(dt, ctx, W, H) {
    // Draw partial scene for atmosphere
    ctx.fillStyle = 'rgba(0,0,15,0.7)';
    ctx.fillRect(0, 0, W, H);
    this._countdownTimer -= dt;
    if (this._countdownTimer <= 0) {
      this._countdownVal--;
      if (this._countdownVal < 0) {
        this._state = 'playing';
        this._startWave();
        return;
      }
      this._countdownTimer = 1.0;
    }
    this._ui.drawCountdown(this._countdownVal);
  }

  _tickGame(dt, ctx, W, H) {
    // Gather input
    this._gatherInput();

    // Update player
    this._ship.update(dt, this._input, W, H);
    this._ship.thrusterParticles(this._particlePool);

    // Player shooting
    const newBullets = this._ship.tryShoot();
    if (newBullets) {
      for (const bd of newBullets) {
        const b = this._bulletPool.get();
        b.init(bd.x, bd.y, bd.angle, bd.speed, bd.damage, bd.owner, bd.seeking, bd.color || null);
        this._bullets.push(b);
      }
      this._audio.playShoot();
      // Emit for multiplayer
      this.emit('player:shoot', {
        x: this._ship.x, y: this._ship.y, angle: this._ship.angle,
        weaponType: this._ship.upgrades.tripleShot ? 'triple' : 'single'
      });
    }

    // Wave manager
    this._waveManager.update(dt, this._enemies, W, wave => {
      this._score += wave * 500;
      this._waveCompleteTimer = 2.5;
      this._state = 'wave_complete';
      this.emit('wave:complete', { waveNumber: wave, score: this._score });
    });

    // Emit player:move throttled (every 3 frames via simple timestamp)
    if (!this._lastMoveEmit || performance.now() - this._lastMoveEmit > 50) {
      this._lastMoveEmit = performance.now();
      this.emit('player:move', this.getLocalPlayerState());
    }

    // Update enemies
    for (const e of this._enemies) {
      if (!e.active) continue;
      const shots = e.update(dt, this._ship.x, this._ship.y, W, H);
      if (shots && shots.length > 0) {
        for (const sd of shots) {
          const b = this._bulletPool.get();
          b.init(sd.x, sd.y, sd.angle, sd.speed, sd.damage, sd.owner);
          this._bullets.push(b);
        }
        this._audio.playEnemyShoot();
      }
    }

    // Update bullets
    const activeEnemies = this._enemies.filter(e => e.active);
    for (let i = this._bullets.length - 1; i >= 0; i--) {
      const b = this._bullets[i];
      if (!b.active) { this._bullets.splice(i, 1); continue; }
      const alive = b.update(dt, b.seeking ? activeEnemies : null);
      if (!alive || b.x < -50 || b.x > W + 50 || b.y < -50 || b.y > H + 50) {
        this._bulletPool.release(b);
        this._bullets.splice(i, 1);
        continue;
      }

      // Collision
      if (b.owner === 'player') {
        for (const e of activeEnemies) {
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (dx * dx + dy * dy < (b.radius + e.radius) * (b.radius + e.radius)) {
            const killed = e.takeDamage(b.damage);
            this._spawnHitParticles(e.x, e.y, 6, '#ff6600');
            this._audio.playHit();
            if (killed) {
              this._onEnemyKilled(e);
            }
            this._bulletPool.release(b);
            this._bullets.splice(i, 1);
            break;
          }
        }
      } else if (b.owner === 'enemy') {
        const dx = b.x - this._ship.x;
        const dy = b.y - this._ship.y;
        if (dx * dx + dy * dy < (b.radius + this._ship.radius) * (b.radius + this._ship.radius)) {
          const hit = this._ship.takeDamage(b.damage);
          if (hit) {
            this._spawnHitParticles(this._ship.x, this._ship.y, 8, '#4488ff');
            this._audio.playHit();
            this.emit('player:hit', { damage: b.damage, hp: this._ship.hp });
            if (!this._ship.isAlive) {
              this._onPlayerDead();
            }
          }
          this._bulletPool.release(b);
          this._bullets.splice(i, 1);
        }
      }
    }

    // Update power-ups
    for (let i = this._powerUps.length - 1; i >= 0; i--) {
      const pu = this._powerUps[i];
      if (!pu.active) { this._powerUps.splice(i, 1); continue; }
      const alive = pu.update(dt);
      if (!alive) { this._powerUps.splice(i, 1); continue; }

      // Collision with player
      const dx = pu.x - this._ship.x;
      const dy = pu.y - this._ship.y;
      if (dx * dx + dy * dy < (pu.radius + this._ship.radius) * (pu.radius + this._ship.radius)) {
        this._ship.collectPowerUp(pu.type);
        this._audio.playPowerUp();
        this._spawnHitParticles(pu.x, pu.y, 10, POWERUP_TYPES[pu.type].color);
        this._powerUps.splice(i, 1);
      }
    }

    // Update particles
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      if (!p.active) { this._particlePool.release(p); this._particles.splice(i, 1); continue; }
      const alive = p.update(dt);
      if (!alive) {
        this._particlePool.release(p);
        this._particles.splice(i, 1);
      }
    }

    // Draw everything
    this._drawScene(ctx, W, H);

    // Draw HUD
    this._ui.drawHUD(this._ship, this._score, this._waveManager.wave, this._ship.scoreMultiplier, this._waveManager.state);

    // Touch controls
    this._touch.draw(ctx);
    this._touch.drawShootButton(ctx);
  }

  _drawScene(ctx, W, H) {
    // Particles
    this._drawParticles(ctx);

    // Power-ups
    for (const pu of this._powerUps) pu.draw(ctx, W, H);

    // Enemies
    for (const e of this._enemies) e.draw(ctx);

    // Remote players
    for (const rs of Object.values(this._remotePlayers)) rs.draw(ctx);

    // Player
    if (this._ship) this._ship.draw(ctx);

    // Bullets
    for (const b of this._bullets) if (b.active) b.draw(ctx);
  }

  _drawParticles(ctx) {
    for (const p of this._particles) if (p.active) p.draw(ctx);
  }

  /* ─── ENEMY KILLED ──────────────────────────────────────────── */
  _onEnemyKilled(enemy) {
    const pts = enemy.points * this._ship.scoreMultiplier;
    this._score += pts;
    this.emit('enemy:kill', { enemyId: enemy.id, points: pts });

    // Explosion particles
    const big = enemy.type === 'boss';
    const count = big ? 40 : (enemy.type === 'fighter' ? 18 : 10);
    const colors = enemy.type === 'boss'
      ? ['#ff2200', '#ff8800', '#ffcc00', '#ffffff']
      : ['#ff6600', '#ff4400', '#ffaa00'];
    this._spawnExplosion(enemy.x, enemy.y, count, colors, big ? 6 : 3.5);
    this._audio.playExplosion(big);

    // Power-up drop (~20% chance, not from boss; bosses always drop one)
    if (big || Math.random() < 0.20) {
      const types = Object.keys(POWERUP_TYPES);
      const t = types[Math.floor(Math.random() * types.length)];
      const pu = new PowerUp();
      pu.init(enemy.x, enemy.y, t);
      this._powerUps.push(pu);
    }
  }

  /* ─── PLAYER DEAD ───────────────────────────────────────────── */
  _onPlayerDead() {
    this._spawnExplosion(this._ship.x, this._ship.y, 50, ['#00ffff', '#4488ff', '#ffffff', '#aaddff'], 5);
    this._audio.playExplosion(true);
    this.emit('player:dead', {});

    // Save to leaderboard
    this._leaderboard.addEntry(this._playerName, this._score, this._waveManager.wave, this._mode);

    this._state = 'gameover';
    this.emit('game:over', { score: this._score, wave: this._waveManager.wave, name: this._playerName });
  }

  /* ─── PARTICLES ─────────────────────────────────────────────── */
  _spawnExplosion(x, y, count, colors, maxRadius) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 200;
      const p = this._particlePool.get();
      p.init(
        x + (Math.random() - 0.5) * 10,
        y + (Math.random() - 0.5) * 10,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        maxRadius * (0.3 + Math.random() * 0.7),
        0.4 + Math.random() * 0.8,
        colors[Math.floor(Math.random() * colors.length)]
      );
      p.active = true;
      this._particles.push(p);
    }
  }

  _spawnHitParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 100;
      const p = this._particlePool.get();
      p.init(
        x + (Math.random() - 0.5) * 6,
        y + (Math.random() - 0.5) * 6,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        1.5 + Math.random() * 2,
        0.2 + Math.random() * 0.3,
        color
      );
      p.active = true;
      this._particles.push(p);
    }
  }

  /* ─── INPUT ─────────────────────────────────────────────────── */
  _gatherInput() {
    const k = this._keys;
    const kb = {
      up:    !!(k['ArrowUp']    || k['w'] || k['W']),
      down:  !!(k['ArrowDown']  || k['s'] || k['S']),
      left:  !!(k['ArrowLeft']  || k['a'] || k['A']),
      right: !!(k['ArrowRight'] || k['d'] || k['D']),
      shoot: !!(k[' '] || k['Space']),
    };
    // Merge touch
    const t = this._touch.input;
    this._input.up    = kb.up    || t.up;
    this._input.down  = kb.down  || t.down;
    this._input.left  = kb.left  || t.left;
    this._input.right = kb.right || t.right;
    this._input.shoot = kb.shoot || t.shoot;
  }

  _handleKeyDown(e) {
    this._keys[e.key] = true;

    // Prevent page scroll for game keys only when canvas is in the viewport
    const GAME_KEYS = new Set([
      'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
      'w','a','s','d','W','A','S','D',' ','p','P',
      '1','2','3','Enter'
    ]);
    if (GAME_KEYS.has(e.key) && this._isCanvasVisible()) e.preventDefault();

    // Global shortcuts
    if (e.key === 'p' || e.key === 'P') {
      if (this._state === 'playing') this.pause();
      else if (this._state === 'paused') this.resume();
    }

    if (e.key === 'Enter') {
      if (this._state === 'start') {
        this.start(this._playerName);
      } else if (this._state === 'gameover') {
        this._state = 'start';
      }
    }

    if (e.key === ' ') {
      if (this._state === 'start') this.start(this._playerName);
      if (this._state === 'gameover') this._state = 'start';
    }

    // Upgrade selection: 1, 2, 3
    if (this._state === 'upgrade') {
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx <= 2) {
        const chosen = this._upgradeSystem.selectUpgrade(idx, this._ship);
        if (chosen) {
          this._audio.playUpgrade();
          this.emit('player:upgrade', { upgradeId: chosen.id, level: this._ship.upgrades[chosen.id] });
          this._startWave();
          this._state = 'playing';
        }
      }
    }
  }

  _handleKeyUp(e) {
    this._keys[e.key] = false;
  }

  _handleMouseMove(e) {
    const rect = this._canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (this._canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (this._canvas.height / rect.height);
    if (this._state === 'upgrade') {
      this._upgradeSystem.handleHover(mx, my, this._canvas.width, this._canvas.height);
    }
  }

  _handleClick(e) {
    const rect = this._canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (this._canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (this._canvas.height / rect.height);

    if (this._state === 'start' || this._state === 'gameover') {
      this._audio._init(); // unlock audio on first interaction
      if (this._state === 'gameover') { this._state = 'start'; return; }
      this.start(this._playerName);
      return;
    }

    if (this._state === 'upgrade') {
      const chosen = this._upgradeSystem.handleClick(mx, my, this._canvas.width, this._canvas.height, this._ship);
      if (chosen) {
        this._audio.playUpgrade();
        this.emit('player:upgrade', { upgradeId: chosen.id, level: this._ship.upgrades[chosen.id] });
        this._startWave();
        this._state = 'playing';
      }
    }
  }
}

/* ─── AUTO-INIT ON DOM READY ──────────────────────────────────── */
// If you add <canvas id="space-game-canvas"> to the page,
// a game instance will be automatically created and exposed.
// Otherwise, create it manually: new SpaceGame('your-canvas-id')
if (typeof window !== 'undefined') {
  window.SpaceGame = SpaceGame;

  // Auto-init is intentionally disabled — the page's inline script
  // creates SpaceGame instances via initGame() and IntersectionObserver
  // to avoid double-rendering on the same canvas.
}

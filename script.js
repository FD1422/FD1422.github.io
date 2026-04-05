/* ═══════════════════════════════════════════════════
   FEDYA — GALAXY EXPLORER
   script.js  —  Full-featured Star Wars edition
   Features:
     1.  Dynamic starfield canvas (parallax layers + shooting stars)
     2.  Lightsaber cursor trail (cyan/blue glow)
     3.  Star Wars crawl auto-skip (8 s or click)
     4.  Scroll reveal animations (IntersectionObserver)
     5.  Lightsaber divider glow pulse on click
     6.  Typing effect on main headline
     7.  Galactic Transmission popup (every 30 s)
     8.  FEDYA easter egg — fireworks + banner
     9.  Hologram flicker effect
     10. Force Level progress bar
   ═══════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────────
   UTILITY HELPERS
   ────────────────────────────────────────────────── */
const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

function injectStyle(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}


/* ══════════════════════════════════════════════════
   1. DYNAMIC STARFIELD CANVAS
      Three depth layers for parallax feel.
      Each layer drifts at a different speed.
      Occasional shooting stars cross the screen.
   ══════════════════════════════════════════════════ */
(function initStarfield() {
  // Re-use existing canvas if the HTML provides one, otherwise create it.
  let canvas = document.getElementById('starfield');
  const created = !canvas;
  if (created) {
    canvas = document.createElement('canvas');
    canvas.id = 'starfield';
  }

  Object.assign(canvas.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
  });

  if (created) document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext('2d');

  /* --- Star layer definitions --- */
  const LAYERS = [
    { count: 130, speed: 0.045, sizeMin: 0.3, sizeMax: 0.9,  baseAlpha: 0.50 }, // far
    { count:  75, speed: 0.12,  sizeMin: 0.9, sizeMax: 1.7,  baseAlpha: 0.72 }, // mid
    { count:  30, speed: 0.24,  sizeMin: 1.7, sizeMax: 2.9,  baseAlpha: 0.95 }, // near
  ];

  let W, H;
  let stars = [];
  let shooters = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeStar(layer) {
    return {
      x:    rand(0, W),
      y:    rand(0, H),
      r:    rand(layer.sizeMin, layer.sizeMax),
      spd:  layer.speed * rand(0.8, 1.2),
      base: layer.baseAlpha * rand(0.6, 1.0),
      twOff: rand(0, Math.PI * 2),
      twSpd: rand(0.008, 0.035),
      layer,
    };
  }

  function buildStars() {
    stars = [];
    LAYERS.forEach(l => { for (let i = 0; i < l.count; i++) stars.push(makeStar(l)); });
  }

  function spawnShooter() {
    shooters.push({
      x:     rand(W * 0.05, W * 0.85),
      y:     rand(0, H * 0.45),
      len:   rand(90, 200),
      spd:   rand(7, 14),
      angle: rand(Math.PI / 9, Math.PI / 3.5),
      life:  1.0,
      decay: rand(0.011, 0.022),
      clr:   Math.random() > 0.45 ? '#88eeff' : '#ffffff',
    });
    setTimeout(spawnShooter, rand(4200, 9500));
  }

  let frame = 0;

  function tick() {
    requestAnimationFrame(tick);
    ctx.clearRect(0, 0, W, H);
    frame++;

    /* --- Draw stars --- */
    stars.forEach(s => {
      s.y += s.spd;
      if (s.y > H + 2) { s.y = -2; s.x = rand(0, W); }

      const tw = 0.5 + 0.5 * Math.sin(frame * s.twSpd + s.twOff);
      const a  = s.base * (0.55 + 0.45 * tw);

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,230,255,${a.toFixed(3)})`;
      ctx.fill();
    });

    /* --- Draw shooting stars --- */
    shooters = shooters.filter(ss => ss.life > 0.01);
    shooters.forEach(ss => {
      const dx = Math.cos(ss.angle) * ss.len * ss.life;
      const dy = Math.sin(ss.angle) * ss.len * ss.life;

      const g = ctx.createLinearGradient(ss.x, ss.y, ss.x - dx, ss.y - dy);
      g.addColorStop(0,   `rgba(255,255,255,${ss.life.toFixed(2)})`);
      g.addColorStop(0.4, ss.clr + Math.round(ss.life * 160).toString(16).padStart(2, '0'));
      g.addColorStop(1,   'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(ss.x - dx, ss.y - dy);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ss.x   += ss.spd * Math.cos(ss.angle);
      ss.y   += ss.spd * Math.sin(ss.angle);
      ss.life -= ss.decay;
    });
  }

  window.addEventListener('resize', () => { resize(); buildStars(); });
  resize();
  buildStars();
  setTimeout(spawnShooter, rand(2000, 5000));
  tick();
}());


/* ══════════════════════════════════════════════════
   2. LIGHTSABER CURSOR TRAIL
      A canvas overlay that follows the mouse and
      draws a glowing cyan/blue fading trail.
   ══════════════════════════════════════════════════ */
(function initCursorTrail() {
  const TRAIL_MAX = 24;
  const trail     = [];

  const tc = document.createElement('canvas');
  tc.id = 'cursor-trail';
  Object.assign(tc.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    width:         '100%',
    height:        '100%',
    zIndex:        '9999',
    pointerEvents: 'none',
  });
  document.body.appendChild(tc);

  const ctx = tc.getContext('2d');

  function resize() { tc.width = window.innerWidth; tc.height = window.innerHeight; }
  window.addEventListener('resize', resize);
  resize();

  document.addEventListener('mousemove', e => {
    trail.push({ x: e.clientX, y: e.clientY });
    if (trail.length > TRAIL_MAX) trail.shift();
  });

  function draw() {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, tc.width, tc.height);

    trail.forEach((pt, i) => {
      const t = (i + 1) / trail.length;   // 0→1 (old→new)
      const r = 1.2 + t * 4.5;

      /* outer glow */
      const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 3.5);
      g.addColorStop(0,   `rgba(0,220,255,${(t * 0.85).toFixed(2)})`);
      g.addColorStop(0.45,`rgba(0,140,255,${(t * 0.4).toFixed(2)})`);
      g.addColorStop(1,   'rgba(0,60,200,0)');

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      /* bright core */
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,245,255,${(t * 0.9).toFixed(2)})`;
      ctx.fill();
    });
  }
  draw();
}());


/* ══════════════════════════════════════════════════
   3. STAR WARS CRAWL AUTO-SKIP
      Hides the crawl after 8 s (or on click/tap),
      then fades in main content and starts the
      typing effect on the hero headline.
   ══════════════════════════════════════════════════ */
injectStyle('blink-anim', `
  @keyframes ssBlink { 0%,100%{opacity:1} 50%{opacity:0.15} }
`);

(function initCrawlSkip() {
  /* Support both the original id used in the HTML and common class names */
  const crawl = $('#crawl-wrapper') || $('#crawl-container') || $('.crawl-container');
  const main  = $('#main-content') || $('main') || $('.main-content');

  if (!crawl) return;

  /* Add a "click to skip" hint */
  const hint = document.createElement('div');
  hint.textContent = '[ Click anywhere · skip crawl ]';
  Object.assign(hint.style, {
    position:   'absolute',
    bottom:     '22px',
    left:       '50%',
    transform:  'translateX(-50%)',
    color:      'rgba(255,200,0,0.72)',
    fontSize:   '0.82rem',
    fontFamily: '"Orbitron","Share Tech Mono",monospace',
    letterSpacing: '0.12em',
    animation:  'ssBlink 1.5s ease-in-out infinite',
    zIndex:     '10',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  });
  if (getComputedStyle(crawl).position === 'static') crawl.style.position = 'relative';
  crawl.appendChild(hint);

  function revealMain() {
    clearTimeout(autoTimer);
    crawl.style.transition = 'opacity 1.1s ease, transform 1.1s ease';
    crawl.style.opacity    = '0';
    crawl.style.transform  = (crawl.style.transform || '') + ' scale(0.97)';

    setTimeout(() => {
      crawl.style.display = 'none';

      if (main) {
        main.classList.remove('hidden');
        main.style.opacity    = '0';
        main.style.transition = 'opacity 0.9s ease';
        requestAnimationFrame(() => requestAnimationFrame(() => { main.style.opacity = '1'; }));
      }

      // Kick off scroll-reveal observer and typing effect
      triggerEntryAnimations();
      initTypingEffect();
    }, 1150);
  }

  /* expose for any existing inline onclick="skipCrawl()" in the HTML */
  window.skipCrawl = revealMain;

  crawl.addEventListener('click',     revealMain, { once: true });
  crawl.addEventListener('touchstart', revealMain, { once: true, passive: true });

  const autoTimer = setTimeout(revealMain, 8000);
}());


/* ══════════════════════════════════════════════════
   4. SCROLL REVEAL — IntersectionObserver
      Automatically tags un-tagged cards/sections
      then fades them in as they enter the viewport.
   ══════════════════════════════════════════════════ */
injectStyle('scroll-reveal', `
  .sr-fade  { opacity:0; transform:translateY(36px); transition:opacity .65s ease, transform .65s ease; }
  .sr-left  { opacity:0; transform:translateX(-38px); transition:opacity .65s ease, transform .65s ease; }
  .sr-right { opacity:0; transform:translateX(38px);  transition:opacity .65s ease, transform .65s ease; }
  .sr-fade.sr-visible, .sr-left.sr-visible, .sr-right.sr-visible {
    opacity:1; transform:translate(0,0);
  }
`);

function triggerEntryAnimations() {
  /* Tag cards that already exist in HTML but aren't yet tagged */
  const selectors = '.stat-card, .mission-card, .intel-card, .hologram-card, '
    + '.holo-card, .game-card, .card, section, article, .fact-block, h2, h3';

  document.querySelectorAll(selectors).forEach((el, i) => {
    if (el.classList.contains('sr-fade') ||
        el.classList.contains('sr-left') ||
        el.classList.contains('sr-right')) return;

    const cls = i % 3 === 0 ? 'sr-fade' : i % 3 === 1 ? 'sr-left' : 'sr-right';
    el.classList.add(cls);
  });

  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      /* Stagger siblings slightly */
      const siblings = Array.from(entry.target.parentElement.children);
      const delay    = siblings.indexOf(entry.target) * 70;
      setTimeout(() => entry.target.classList.add('sr-visible'), delay);
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.10, rootMargin: '0px 0px -35px 0px' });

  document.querySelectorAll('.sr-fade, .sr-left, .sr-right').forEach(el => obs.observe(el));
}


/* ══════════════════════════════════════════════════
   5. LIGHTSABER DIVIDER GLOW PULSE
      Any element with class "lightsaber-divider",
      "saber-divider", or matching [class*="saber"]
      gets a glow-pulse animation when clicked.
   ══════════════════════════════════════════════════ */
injectStyle('saber-divider-anim', `
  @keyframes saberPulse {
    0%   { filter:brightness(1)   drop-shadow(0 0 3px #00eeff); transform:scaleX(1); }
    20%  { filter:brightness(2.8) drop-shadow(0 0 20px #00eeff) drop-shadow(0 0 40px #0080ff); transform:scaleX(1.04); }
    55%  { filter:brightness(1.6) drop-shadow(0 0 10px #00ccff); transform:scaleX(1.01); }
    100% { filter:brightness(1)   drop-shadow(0 0 3px #00eeff); transform:scaleX(1); }
  }
  .saber-active { animation: saberPulse 0.65s ease forwards !important; cursor:pointer; }
  .lightsaber-divider, .saber-divider, [class*="saber-line"], hr.saber { cursor:pointer; }
`);

(function initSaberDividers() {
  function attach(el) {
    if (el._saberBound) return;
    el._saberBound = true;
    el.addEventListener('click', () => {
      el.classList.remove('saber-active');
      void el.offsetWidth;
      el.classList.add('saber-active');
      el.addEventListener('animationend', () => el.classList.remove('saber-active'), { once: true });
    });
  }

  const SEL = '.lightsaber-divider, .saber-divider, [class*="saber-line"], hr.saber';
  $$(SEL).forEach(attach);

  new MutationObserver(muts => muts.forEach(m =>
    m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(SEL)) attach(n);
      $$(SEL, n).forEach(attach);
    })
  )).observe(document.body, { childList: true, subtree: true });
}());


/* ══════════════════════════════════════════════════
   6. TYPING EFFECT
      Targets: [data-typetext], .typewriter,
      #hero-title, .hero-title, h1.main-title
      Types out the element's text character by
      character after the crawl ends.
   ══════════════════════════════════════════════════ */
injectStyle('cursor-blink', `
  @keyframes cursorBlink { 0%,100%{border-color:#00eeff} 50%{border-color:transparent} }
`);

function initTypingEffect() {
  const el = $('[data-typetext], .typewriter, #hero-title, .hero-title, h1.main-title');
  if (!el || el._typed) return;
  el._typed = true;

  const full = el.dataset.typetext || el.textContent.trim();
  el.textContent = '';
  el.style.borderRight  = '3px solid #00eeff';
  el.style.paddingRight = '3px';
  el.style.animation    = 'cursorBlink 0.7s step-end infinite';
  el.style.display      = el.style.display || 'inline-block';

  let i = 0;
  function type() {
    if (i < full.length) {
      el.textContent += full[i++];
      setTimeout(type, 48 + rand(-12, 28));
    } else {
      setTimeout(() => {
        el.style.borderRight = 'none';
        el.style.animation   = 'none';
      }, 900);
    }
  }
  type();
}


/* ══════════════════════════════════════════════════
   7. GALACTIC TRANSMISSION POPUP
      Appears every 30 s with a space fact or
      Star Wars quote. Auto-dismisses after 5 s.
      Has a draining progress bar and a close button.
   ══════════════════════════════════════════════════ */
injectStyle('galactic-popup', `
  #galactic-popup {
    position:fixed; bottom:26px; right:26px;
    max-width:310px; width:calc(100vw - 52px);
    background:rgba(0,12,35,0.93);
    border:1px solid rgba(0,200,255,0.45);
    border-radius:10px; padding:15px 18px 12px;
    color:#9de8ff;
    font-family:"Orbitron","Share Tech Mono","Courier New",monospace;
    font-size:0.77rem; line-height:1.55;
    z-index:8000;
    box-shadow:0 0 28px rgba(0,170,255,0.22),inset 0 0 14px rgba(0,70,160,0.14);
    opacity:0; transform:translateY(18px);
    transition:opacity .4s ease, transform .4s ease;
    pointer-events:auto;
  }
  #galactic-popup.gp-show { opacity:1; transform:translateY(0); }
  #galactic-popup .gp-title {
    color:#ffe81a; font-size:0.67rem;
    letter-spacing:.14em; margin-bottom:9px;
    text-transform:uppercase;
  }
  #galactic-popup .gp-close {
    position:absolute; top:9px; right:12px;
    background:none; border:none; color:rgba(0,210,255,.55);
    font-size:.95rem; line-height:1; cursor:pointer; padding:0;
  }
  #galactic-popup .gp-close:hover { color:#fff; }
  #galactic-popup .gp-bar-track {
    height:3px; background:rgba(0,180,255,.18);
    border-radius:3px; margin-top:11px; overflow:hidden;
  }
  #galactic-popup .gp-bar-fill {
    height:100%;
    background:linear-gradient(90deg,#0060ff,#00eeff);
    transform-origin:left; transform:scaleX(1);
    transition:transform 5s linear;
    border-radius:3px;
  }
`);

(function initSpaceFactPopup() {
  const facts = [
    "The Death Star would cost ~$852 QUADRILLION to build. That's a lot of V-Bucks.",
    "Space is completely silent. Perfect for gaming without distractions.",
    "A day on Venus is longer than a year on Venus. Even school isn't THAT long.",
    "Neutron stars can spin 600 times per second — faster than any Brawl Stars match.",
    "Astronomers confirmed the Milky Way smells like raspberries and rum.",
    "There are more stars in space than grains of sand on Earth. Wild.",
    "Yoda's species is still officially unknown. Even Disney doesn't know.",
    "Saturn's rings are only ~10 m thick but hundreds of thousands of km wide.",
    '"The Force will be with you. Always." — Obi-Wan Kenobi',
    '"Do. Or do not. There is no try." — Yoda (applies to Fortnite ranked too)',
    "In space, nobody can hear you get eliminated. Skill issue.",
    "Average Stormtrooper accuracy: 0.003%. Still higher than some ranked sessions.",
    "1.3 million Earths could fit inside the Sun. Bigger than any Fortnite map.",
    "Black holes don't suck — they just have very strong gravity. Like ranked.",
    "Han shot first. This is not up for debate. Ever.",
    "A teaspoon of neutron star would weigh about 10 million tonnes. Heavy.",
    "Light from the Sun takes 8 minutes to reach us. Build a wall in that time.",
  ];

  const popup = document.createElement('div');
  popup.id = 'galactic-popup';
  popup.innerHTML = `
    <div class="gp-title">&#9733; Galactic Transmission</div>
    <button class="gp-close" aria-label="Close">&#x2715;</button>
    <div id="gp-fact"></div>
    <div class="gp-bar-track"><div class="gp-bar-fill" id="gp-bar"></div></div>
  `;
  document.body.appendChild(popup);

  let dismissId = null;

  function showFact() {
    $('#gp-fact').textContent = facts[randInt(0, facts.length - 1)];
    popup.classList.add('gp-show');

    const bar = $('#gp-bar');
    bar.style.transition = 'none';
    bar.style.transform  = 'scaleX(1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = 'transform 5s linear';
      bar.style.transform  = 'scaleX(0)';
    }));

    clearTimeout(dismissId);
    dismissId = setTimeout(hideFact, 5000);
  }

  function hideFact() { popup.classList.remove('gp-show'); }

  popup.querySelector('.gp-close').addEventListener('click', () => {
    clearTimeout(dismissId);
    hideFact();
  });

  /* First popup after 30 s, then every 30 s */
  setTimeout(function loop() { showFact(); setTimeout(loop, 30000); }, 30000);
}());


/* ══════════════════════════════════════════════════
   8. EASTER EGG — Type "FEDYA" anywhere
      Triggers a full-screen fireworks burst and
      a glowing "The Force is Strong" banner.
   ══════════════════════════════════════════════════ */
(function initEasterEgg() {
  const SECRET = 'FEDYA';
  let buf = '';

  /* Fireworks canvas */
  const fw = document.createElement('canvas');
  fw.id = 'fireworks-canvas';
  Object.assign(fw.style, {
    position: 'fixed', top: '0', left: '0',
    width: '100%', height: '100%',
    zIndex: '9997', pointerEvents: 'none',
  });
  document.body.appendChild(fw);
  const fctx = fw.getContext('2d');

  function fwResize() { fw.width = window.innerWidth; fw.height = window.innerHeight; }
  window.addEventListener('resize', fwResize);
  fwResize();

  const COLORS = [
    '#ffe81a','#ff4444','#00eeff','#ff88ff',
    '#44ff88','#ff8844','#ffffff','#88aaff','#ffaa00',
  ];

  let parts  = [];
  let fwLoop = false;

  function burst(x, y, big) {
    const n = big ? 180 : 90;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + rand(-0.25, 0.25);
      const spd   = rand(1.8, big ? 10 : 6.5);
      parts.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - rand(0, big ? 2 : 1),
        alpha: 1,
        decay: rand(0.011, 0.024),
        r: rand(1.4, big ? 4 : 3),
        clr: COLORS[randInt(0, COLORS.length - 1)],
        grav: 0.075,
      });
    }
  }

  function launchShow() {
    const W = fw.width, H = fw.height;
    const pts = [
      [W*.18,H*.30],[W*.50,H*.22],[W*.82,H*.30],
      [W*.33,H*.48],[W*.67,H*.44],[W*.50,H*.35],
    ];
    pts.forEach(([x,y], i) => setTimeout(() => burst(x, y, i===2||i===5), i*170));
    setTimeout(() => burst(W/2, H/2.8, true), 650);
    showBanner();
  }

  function showBanner() {
    let b = $('#fedya-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'fedya-banner';
      Object.assign(b.style, {
        position:'fixed', top:'50%', left:'50%',
        transform:'translate(-50%,-50%) scale(0.4)',
        zIndex:'9996', textAlign:'center',
        fontFamily:'"Orbitron","Share Tech Mono",monospace',
        fontSize:'clamp(1.3rem,5.5vw,3rem)',
        fontWeight:'900',
        color:'#ffe81a',
        textShadow:'0 0 18px #ffe81a, 0 0 40px #ff8800, 0 0 80px #ff4400',
        letterSpacing:'.1em', lineHeight:'1.35',
        pointerEvents:'none',
        transition:'transform .55s cubic-bezier(.17,.67,.3,1.55), opacity .5s ease',
        opacity:'0',
      });
      b.innerHTML = '&#127942; FEDYA &#127942;'
        + '<br><span style="font-size:.48em;color:#00eeff;text-shadow:0 0 12px #00eeff">'
        + 'The Force Is Strong With This One</span>';
      document.body.appendChild(b);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      b.style.opacity   = '1';
      b.style.transform = 'translate(-50%,-50%) scale(1)';
    }));
    setTimeout(() => {
      b.style.opacity   = '0';
      b.style.transform = 'translate(-50%,-50%) scale(0.85)';
    }, 3600);
  }

  function tickFW() {
    if (!fwLoop && parts.length === 0) return;
    requestAnimationFrame(tickFW);

    fctx.fillStyle = 'rgba(0,0,0,0.16)';
    fctx.fillRect(0, 0, fw.width, fw.height);

    parts = parts.filter(p => p.alpha > 0.015);
    parts.forEach(p => {
      const grd = fctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*2.2);
      grd.addColorStop(0,   '#ffffff');
      grd.addColorStop(0.3, p.clr);
      grd.addColorStop(1,   'rgba(0,0,0,0)');

      fctx.globalAlpha = p.alpha;
      fctx.beginPath();
      fctx.arc(p.x, p.y, p.r * 2.2, 0, Math.PI * 2);
      fctx.fillStyle = grd;
      fctx.fill();

      p.x += p.vx;  p.y += p.vy;
      p.vy += p.grav;
      p.vx *= 0.985; p.alpha -= p.decay;
    });
    fctx.globalAlpha = 1;

    if (parts.length === 0) {
      fwLoop = false;
      fctx.clearRect(0, 0, fw.width, fw.height);
    }
  }

  document.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toUpperCase() : '';
    if (!k) return;
    buf = (buf + k).slice(-SECRET.length);
    if (buf === SECRET) {
      buf = '';
      fwLoop = true;
      launchShow();
      tickFW();
    }
  });
}());


/* ══════════════════════════════════════════════════
   9. HOLOGRAM FLICKER EFFECT
      Cards with class "hologram-card", "holo-card",
      or matching [class*="hologram"/"holo-"] flicker
      periodically like broken projectors.
   ══════════════════════════════════════════════════ */
injectStyle('holo-flicker', `
  @keyframes holoFlicker {
    0%   {opacity:1;   filter:brightness(1) saturate(1);}
    4%   {opacity:.80; filter:brightness(1.35) saturate(1.5) hue-rotate(6deg);}
    5%   {opacity:1;   filter:brightness(.92);}
    8%   {opacity:.87; filter:brightness(1.18) hue-rotate(-4deg);}
    9%   {opacity:1;   filter:brightness(1);}
    93%  {opacity:1;   filter:brightness(1);}
    95%  {opacity:.76; filter:brightness(1.45) saturate(1.7);}
    96%  {opacity:1;   filter:brightness(.88);}
    98%  {opacity:.91; filter:brightness(1.22);}
    100% {opacity:1;   filter:brightness(1);}
  }
`);

(function initHologramFlicker() {
  const SEL = '.hologram-card,.holo-card,[class*="hologram"],[class*="holo-"]';

  function flicker(el) {
    const dur = (rand(0.14, 0.28)).toFixed(2) + 's';
    el.style.animation = `holoFlicker ${dur} steps(1) 1`;
    el.addEventListener('animationend', () => {
      el.style.animation = '';
      setTimeout(() => flicker(el), rand(5500, 20000));
    }, { once: true });
  }

  $$(SEL).forEach(el => setTimeout(() => flicker(el), rand(800, 9000)));

  new MutationObserver(muts => muts.forEach(m =>
    m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(SEL)) setTimeout(() => flicker(n), rand(400, 2500));
      $$(SEL, n).forEach(c => setTimeout(() => flicker(c), rand(400, 2500)));
    })
  )).observe(document.body, { childList: true, subtree: true });
}());


/* ══════════════════════════════════════════════════
   10. FORCE LEVEL PROGRESS BAR
       A vertical glowing bar fixed on the right side
       that fills as the user scrolls down the page.
       Color shifts from blue → cyan → green → gold.
   ══════════════════════════════════════════════════ */
injectStyle('force-bar', `
  #force-bar-wrap {
    position:fixed; top:50%; right:14px;
    transform:translateY(-50%);
    display:flex; flex-direction:column;
    align-items:center; gap:5px;
    z-index:7000; pointer-events:none;
  }
  #force-bar-label {
    color:rgba(0,200,255,.65);
    font-family:"Orbitron","Share Tech Mono",monospace;
    font-size:.42rem; letter-spacing:.13em;
    writing-mode:vertical-rl; text-orientation:mixed;
    transform:rotate(180deg);
  }
  #force-bar-track {
    width:6px; height:155px;
    background:rgba(0,70,110,.32);
    border-radius:4px;
    border:1px solid rgba(0,150,200,.28);
    position:relative; overflow:hidden;
  }
  #force-bar-fill {
    position:absolute; bottom:0; left:0;
    width:100%; height:0%;
    border-radius:4px;
    transition:height .28s ease, background .5s ease;
    box-shadow:0 0 8px #00eeff, 0 0 18px rgba(0,200,255,.35);
  }
  #force-bar-dot {
    position:absolute; left:50%; transform:translateX(-50%);
    width:12px; height:12px; border-radius:50%;
    background:#00eeff;
    box-shadow:0 0 10px #00eeff,0 0 22px rgba(0,210,255,.55);
    transition:bottom .28s ease;
  }
  #force-bar-pct {
    color:rgba(0,200,255,.8);
    font-family:"Orbitron","Share Tech Mono",monospace;
    font-size:.52rem; letter-spacing:.04em;
  }
  @media(max-width:480px){
    #force-bar-track{height:110px;}
    #force-bar-wrap{right:8px;}
  }
`);

(function initForceBar() {
  const wrap = document.createElement('div');
  wrap.id = 'force-bar-wrap';
  wrap.innerHTML = `
    <div id="force-bar-label">FORCE LVL</div>
    <div id="force-bar-track">
      <div id="force-bar-fill"></div>
      <div id="force-bar-dot"></div>
    </div>
    <div id="force-bar-pct">0%</div>
  `;
  document.body.appendChild(wrap);

  const fill = $('#force-bar-fill');
  const dot  = $('#force-bar-dot');
  const pct  = $('#force-bar-pct');

  function update() {
    const scrolled = window.scrollY || document.documentElement.scrollTop;
    const total    = document.documentElement.scrollHeight - window.innerHeight;
    const p        = total > 0 ? Math.round((scrolled / total) * 100) : 0;

    fill.style.height = p + '%';
    dot.style.bottom  = `calc(${p}% - 6px)`;
    pct.textContent   = p + '%';

    /* Colour phases */
    if (p < 33) {
      fill.style.background = 'linear-gradient(to top,#0044ff,#0099ff)';
      fill.style.boxShadow  = '0 0 8px #0088ff, 0 0 18px rgba(0,150,255,.35)';
      dot.style.background  = '#0099ff';
      dot.style.boxShadow   = '0 0 10px #0099ff, 0 0 22px rgba(0,150,255,.5)';
    } else if (p < 66) {
      fill.style.background = 'linear-gradient(to top,#0099ff,#00eeff)';
      fill.style.boxShadow  = '0 0 8px #00eeff, 0 0 18px rgba(0,220,255,.35)';
      dot.style.background  = '#00eeff';
      dot.style.boxShadow   = '0 0 10px #00eeff, 0 0 22px rgba(0,220,255,.5)';
    } else if (p < 90) {
      fill.style.background = 'linear-gradient(to top,#00eeff,#44ff88)';
      fill.style.boxShadow  = '0 0 8px #44ff88, 0 0 18px rgba(60,255,130,.35)';
      dot.style.background  = '#44ff88';
      dot.style.boxShadow   = '0 0 10px #44ff88, 0 0 22px rgba(60,255,130,.5)';
    } else {
      fill.style.background = 'linear-gradient(to top,#44ff88,#ffe81a)';
      fill.style.boxShadow  = '0 0 10px #ffe81a, 0 0 24px rgba(255,230,0,.5)';
      dot.style.background  = '#ffe81a';
      dot.style.boxShadow   = '0 0 12px #ffe81a, 0 0 28px rgba(255,230,0,.55)';
    }
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
}());


/* ──────────────────────────────────────────────────
   SMOOTH SCROLL for any #anchor links
   ────────────────────────────────────────────────── */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const target = document.querySelector(a.getAttribute('href'));
  if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});


/* ──────────────────────────────────────────────────
   DEV CONSOLE GREETING
   ────────────────────────────────────────────────── */
console.log(
  '%c★  FEDYA\'S GALACTIC SITE  ★\n'
  + '%cMay the Force be with you!\n'
  + '%cPsst... type %cFEDYA%c anywhere for a surprise.',
  'color:#ffe81a;font-size:1.05rem;font-weight:900;text-shadow:0 0 8px #ffe81a',
  'color:#00eeff;font-size:.85rem',
  'color:#aaa;font-size:.78rem',
  'color:#00eeff;font-weight:bold;font-size:.78rem',
  'color:#aaa;font-size:.78rem'
);

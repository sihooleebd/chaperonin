// ── Pipeline SVG animation ────────────────────────────────
(function () {
  const NODES = {
    rfd:   { dot: 'rfd-dot',   prog: 'rfd-prog',   rect: 'rfd-rect',   progMax: 230 },
    relax: { dot: 'relax-dot', prog: 'relax-prog',  rect: 'relax-rect', progMax: 230 },
    pymol: { dot: 'pymol-dot', prog: 'pymol-prog',  rect: 'pymol-rect', progMax: 230 },
  };
  const ORDER = ['rfd', 'relax', 'pymol'];
  const DURATIONS = { rfd: 2800, relax: 1900, pymol: 1400 };

  function set(id, attrs) {
    const el = document.getElementById(id);
    if (!el) return;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function animProg(progId, maxW, ms) {
    const el = document.getElementById(progId);
    if (!el) return;
    const steps = 40;
    const stepMs = ms / steps;
    for (let i = 0; i <= steps; i++) {
      el.setAttribute('width', ((i / steps) * maxW).toFixed(1));
      await sleep(stepMs);
    }
  }

  async function cycle() {
    // reset all
    for (const key of ORDER) {
      const n = NODES[key];
      set(n.dot,  { fill: '#1e2840' });
      set(n.prog, { width: '0' });
      set(n.rect, { stroke: '#1c2840' });
    }

    // io nodes stay lit
    await sleep(500);

    for (const key of ORDER) {
      const n = NODES[key];
      const dur = DURATIONS[key];

      // queued
      set(n.dot,  { fill: '#f59e0b' });
      set(n.rect, { stroke: 'rgba(245,158,11,0.4)' });
      await sleep(500);

      // running
      set(n.dot,  { fill: '#3b82f6' });
      set(n.rect, { stroke: 'rgba(59,130,246,0.5)' });
      await animProg(n.prog, n.progMax, dur);

      // done
      set(n.dot,  { fill: '#10b981' });
      set(n.rect, { stroke: 'rgba(16,185,129,0.35)' });
      set(n.prog, { fill: '#10b981' });
      await sleep(400);
    }

    await sleep(2400);
    // reset prog fill color for next cycle
    for (const key of ORDER) set(NODES[key].prog, { fill: '#3b82f6' });
    cycle();
  }

  // Wait for SVG to be in DOM
  window.addEventListener('DOMContentLoaded', () => { sleep(800).then(cycle); });
})();

// ── Scroll reveal ─────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const delay = +(e.target.dataset.delay || 0);
      setTimeout(() => e.target.classList.add('in'), delay);
      io.unobserve(e.target);
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
});

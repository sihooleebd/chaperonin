(function () {
  'use strict';

  // ───────────────────────────────────────────────────────────
  // Hero diagram constants
  // ───────────────────────────────────────────────────────────

  var CENTER = { x: 300, y: 230 };

  var NODES = [
    { id: 'rfd',         x: 216, y: 85  },
    { id: 'alphafold',   x: 384, y: 85  },
    { id: 'pymol',       x: 468, y: 230 },
    { id: 'pdb2fasta',   x: 384, y: 375 },
    { id: 'rosetta',     x: 216, y: 375 },
    { id: 'rosettafold', x: 132, y: 230 },
  ];

  var prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────────────────────────────────────────────────────
  // Section reveals (intersection observer)
  // ───────────────────────────────────────────────────────────

  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  // ───────────────────────────────────────────────────────────
  // Hero diagram: line-draw on load, mark all nodes connected
  // ───────────────────────────────────────────────────────────

  function setNodeConnected(id, yes) {
    var nodeEl = document.getElementById('node-' + id);
    if (!nodeEl) return;
    if (yes) nodeEl.classList.add('connected');
    else     nodeEl.classList.remove('connected');
  }

  function drawEdges() {
    NODES.forEach(function (n, i) {
      var edge = document.getElementById('edge-' + n.id);
      if (!edge) return;
      var delay = prefersReducedMotion ? 0 : (180 + i * 100);
      setTimeout(function () {
        edge.classList.add('drawn');
        setNodeConnected(n.id, true);
      }, delay);
    });
  }

  // Run draw immediately so the scene is "finished" on first paint
  drawEdges();

  // ───────────────────────────────────────────────────────────
  // Pulse dot travel: center → node
  // ───────────────────────────────────────────────────────────

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function animatePulse(node) {
    return new Promise(function (resolve) {
      var pulseEl = document.getElementById('pulse-' + node.id);
      if (!pulseEl) { resolve(); return; }

      if (prefersReducedMotion) {
        // Just flash the destination, no travel
        flashNode(node.id, resolve);
        return;
      }

      var duration = 720;
      var startTime = null;

      pulseEl.style.opacity = '1';
      pulseEl.setAttribute('cx', CENTER.x);
      pulseEl.setAttribute('cy', CENTER.y);

      function step(ts) {
        if (!startTime) startTime = ts;
        var raw = (ts - startTime) / duration;
        var t   = easeInOut(Math.min(raw, 1));

        pulseEl.setAttribute('cx', CENTER.x + (node.x - CENTER.x) * t);
        pulseEl.setAttribute('cy', CENTER.y + (node.y - CENTER.y) * t);
        pulseEl.style.opacity = raw < 0.85 ? '1' : String(Math.max(0, (1 - raw) / 0.15));

        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          pulseEl.style.opacity = '0';
          flashNode(node.id, resolve);
        }
      }

      requestAnimationFrame(step);
    });
  }

  function flashNode(id, done) {
    var nodeEl = document.getElementById('node-' + id);
    if (nodeEl) {
      nodeEl.classList.add('activated');
      setTimeout(function () {
        nodeEl.classList.remove('activated');
        if (done) done();
      }, 420);
    } else if (done) {
      done();
    }
  }

  // ───────────────────────────────────────────────────────────
  // Run button: staggered dispatch
  // ───────────────────────────────────────────────────────────

  var isRunning = false;

  function runPipeline() {
    if (isRunning) return;
    isRunning = true;

    var btn = document.getElementById('run-btn');
    if (!btn) return;
    var originalText = btn.textContent;
    btn.classList.add('running');
    btn.textContent = '● Running…';

    var promises = NODES.map(function (n, i) {
      return new Promise(function (resolve) {
        setTimeout(function () { animatePulse(n).then(resolve); }, i * 140);
      });
    });

    Promise.all(promises).then(function () {
      setTimeout(function () {
        btn.classList.remove('running');
        btn.textContent = originalText;
        isRunning = false;
      }, 280);
    });
  }

  var runBtn = document.getElementById('run-btn');
  if (runBtn) runBtn.addEventListener('click', runPipeline);

})();

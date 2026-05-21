(function () {
  'use strict';

  var CENTER = { x: 300, y: 230 };

  var NODES = [
    { id: 'rfd',         x: 216, y: 85  },
    { id: 'alphafold',   x: 384, y: 85  },
    { id: 'pymol',       x: 468, y: 230 },
    { id: 'pdb2fasta',   x: 384, y: 375 },
    { id: 'rosetta',     x: 216, y: 375 },
    { id: 'rosettafold', x: 132, y: 230 },
  ];

  // Which nodes start connected
  var connected = { rfd: true, pymol: true, rosetta: true };

  var isRunning = false;

  // ── Connect / disconnect ──────────────────────────────────

  function setConnected(id, yes) {
    var edgeEl = document.getElementById('edge-' + id);
    var nodeEl = document.getElementById('node-' + id);
    if (!edgeEl || !nodeEl) return;

    if (yes) {
      connected[id] = true;
      edgeEl.classList.add('connected');
      nodeEl.classList.add('connected');
    } else {
      delete connected[id];
      edgeEl.classList.remove('connected');
      nodeEl.classList.remove('connected');
    }
  }

  // Apply initial state
  NODES.forEach(function (n) {
    setConnected(n.id, !!connected[n.id]);
  });

  // ── Idle animation ───────────────────────────────────────

  function idleTick() {
    if (isRunning) return;

    var ids = NODES.map(function (n) { return n.id; });
    var id  = ids[Math.floor(Math.random() * ids.length)];

    // Keep between 1 and 5 connections at all times
    var count = Object.keys(connected).length;
    var isConn = !!connected[id];

    if (isConn && count <= 1) return;     // don't drop to 0
    if (!isConn && count >= 5) return;    // don't connect all

    setConnected(id, !isConn);
  }

  setInterval(idleTick, 2400);

  // ── Pulse animation ──────────────────────────────────────

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function animatePulse(node) {
    return new Promise(function (resolve) {
      var pulseEl = document.getElementById('pulse-' + node.id);
      if (!pulseEl) { resolve(); return; }

      var duration = 680;
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
        // Fade out in the last 15% of travel
        pulseEl.style.opacity = raw < 0.85 ? '1' : String(Math.max(0, (1 - raw) / 0.15));

        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          pulseEl.style.opacity = '0';
          // Flash the destination node
          var nodeEl = document.getElementById('node-' + node.id);
          if (nodeEl) {
            nodeEl.classList.add('activated');
            setTimeout(function () { nodeEl.classList.remove('activated'); }, 500);
          }
          resolve();
        }
      }

      requestAnimationFrame(step);
    });
  }

  // ── Run pipeline ─────────────────────────────────────────

  function runPipeline() {
    if (isRunning) return;
    isRunning = true;

    var btn = document.getElementById('run-btn');
    btn.classList.add('running');
    btn.textContent = '● Running…';

    // Connect everything
    NODES.forEach(function (n) { setConnected(n.id, true); });

    // Brief pause, then fire pulses staggered
    setTimeout(function () {
      var promises = NODES.map(function (n, i) {
        return new Promise(function (resolve) {
          setTimeout(function () { animatePulse(n).then(resolve); }, i * 160);
        });
      });

      Promise.all(promises).then(function () {
        setTimeout(function () {
          btn.classList.remove('running');
          btn.textContent = '►  Run Pipeline';
          isRunning = false;
        }, 320);
      });
    }, 350);
  }

  var runBtn = document.getElementById('run-btn');
  if (runBtn) runBtn.addEventListener('click', runPipeline);

})();

(function () {
  'use strict';

  var mainScroll  = document.getElementById('main-scroll');
  var progressBar = document.getElementById('scroll-progress');
  var sbPip       = document.getElementById('sb-pip');
  var sbText      = document.getElementById('sb-text');
  var outDot      = document.getElementById('sb-out-dot');

  var SB_MAX = 200; // max width of progress rects in sidebar SVG

  var NODES = {
    rfd:   { dot: 'sb-rfd-dot',   prog: 'sb-rfd-prog',   rect: 'sb-rfd-rect',   color: '#8b5cf6' },
    relax: { dot: 'sb-relax-dot', prog: 'sb-relax-prog', rect: 'sb-relax-rect', color: '#10b981' },
    pymol: { dot: 'sb-pymol-dot', prog: 'sb-pymol-prog', rect: 'sb-pymol-rect', color: '#f59e0b' },
  };

  var SCENE_ORDER = ['init', 'rfd', 'relax', 'pymol', 'done'];

  function el(id) { return document.getElementById(id); }

  function setNodeState(key, state) {
    var n    = NODES[key];
    var dot  = el(n.dot);
    var prog = el(n.prog);
    var rect = el(n.rect);

    dot.classList.remove('sb-dot-running');

    if (state === 'running') {
      dot.style.fill         = '#3b82f6';
      rect.style.stroke      = '#3b82f6';
      rect.style.strokeWidth = '1.5';
      dot.classList.add('sb-dot-running');
    } else if (state === 'done') {
      dot.style.fill         = n.color;
      rect.style.stroke      = n.color;
      rect.style.strokeWidth = '1';
      prog.setAttribute('width', String(SB_MAX));
    } else {
      dot.style.fill         = '#475569';
      rect.style.stroke      = '#161f30';
      rect.style.strokeWidth = '1';
      prog.setAttribute('width', '0');
    }
  }

  function setRunningProgress(key, fraction) {
    var w = Math.round(Math.min(1, Math.max(0, fraction)) * SB_MAX);
    el(NODES[key].prog).setAttribute('width', String(w));
  }

  function setStatus(cls, text) {
    sbPip.className        = 'sb-status-pip'  + (cls ? ' ' + cls : '');
    sbText.className       = 'sb-status-text' + (cls ? ' ' + cls : '');
    sbText.textContent     = text;
  }

  var nodeOrder = { rfd: 1, relax: 2, pymol: 3 };

  function updateSidebar(activeEl, scrollTop) {
    var sceneKey   = activeEl ? activeEl.dataset.scene : 'init';
    var currentIdx = SCENE_ORDER.indexOf(sceneKey);

    Object.keys(NODES).forEach(function (key) {
      var nodeIdx = nodeOrder[key];
      if (currentIdx > nodeIdx) {
        setNodeState(key, 'done');
      } else if (currentIdx === nodeIdx) {
        setNodeState(key, 'running');
        var sceneTop    = activeEl.offsetTop;
        var sceneHeight = activeEl.offsetHeight;
        var clientH     = mainScroll.clientHeight;
        setRunningProgress(key, (scrollTop - sceneTop + clientH * 0.45) / sceneHeight);
      } else {
        setNodeState(key, 'idle');
      }
    });

    if (sceneKey === 'done') {
      if (outDot) outDot.style.fill = '#10b981';
      setStatus('done', 'pipeline.done');
    } else if (sceneKey === 'init' || currentIdx < 0) {
      if (outDot) outDot.style.fill = '#475569';
      setStatus('', 'idle');
    } else {
      if (outDot) outDot.style.fill = '#475569';
      var labels = { rfd: 'node.running · rfd', relax: 'node.running · relax', pymol: 'node.running · pymol' };
      setStatus('running', labels[sceneKey] || 'running');
    }
  }

  var scenes = document.querySelectorAll('.scene');

  function getActiveScene(scrollTop) {
    var active    = null;
    var threshold = mainScroll.clientHeight * 0.5;
    scenes.forEach(function (s) {
      if (scrollTop + threshold >= s.offsetTop) active = s;
    });
    return active;
  }

  mainScroll.addEventListener('scroll', function () {
    var scrollTop = mainScroll.scrollTop;
    var maxScroll = mainScroll.scrollHeight - mainScroll.clientHeight;
    progressBar.style.transform = 'scaleX(' + (maxScroll > 0 ? scrollTop / maxScroll : 0) + ')';
    updateSidebar(getActiveScene(scrollTop), scrollTop);
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) entry.target.classList.add('active');
    });
  }, { root: mainScroll, threshold: 0.15 });

  scenes.forEach(function (s) { observer.observe(s); });

  setTimeout(function () {
    var init = document.querySelector('.scene-init');
    if (init) init.classList.add('active');
  }, 200);

})();

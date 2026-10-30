// RGPia Web Service shell: builds one tab per entry in services.js and shows the selected
// service in its own frame. Frames load on first visit and stay alive when switching tabs.
(function () {
  'use strict';
  var services = window.RGPIA_SERVICES || [];
  var tabs = document.getElementById('tabs');
  var panels = document.getElementById('panels');
  var popout = document.getElementById('popout');
  var frames = {};

  services.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.id = 'tab-' + s.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'panel-' + s.id);
    b.title = s.description || s.label;
    b.textContent = s.label;
    b.addEventListener('click', function () { location.hash = s.id; });
    tabs.appendChild(b);
  });

  // Arrow keys move between tabs
  tabs.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var list = Array.prototype.slice.call(tabs.children);
    var i = list.indexOf(document.activeElement);
    if (i < 0) return;
    var next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.focus();
    next.click();
  });

  function show(id) {
    var s = services.find(function (x) { return x.id === id; }) || services[0];
    if (!s) return;
    if (!frames[s.id]) {
      var f = document.createElement('iframe');
      f.className = 'panel';
      f.id = 'panel-' + s.id;
      f.src = s.path;
      f.title = s.title || s.label;
      f.setAttribute('role', 'tabpanel');
      f.setAttribute('aria-labelledby', 'tab-' + s.id);
      panels.appendChild(f);
      frames[s.id] = f;
    }
    Object.keys(frames).forEach(function (k) { frames[k].hidden = k !== s.id; });
    Array.prototype.forEach.call(tabs.children, function (b) {
      var on = b.id === 'tab-' + s.id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    popout.href = s.path;
    document.title = (s.title || s.label) + ' · RGPia Web Service';
  }

  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  show(location.hash.slice(1));
})();

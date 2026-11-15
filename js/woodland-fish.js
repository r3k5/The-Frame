// Schedules fish animations along routes in the lake.
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Each group has two CSS routes within its own part of the lake.
  var waterRoutes = {
    upper: ['cove', 'inlet'],
    middle: ['far', 'bend'],
    foreground: ['near', 'deep'],
  };
  var fish = Array.prototype.map.call(document.querySelectorAll('.woodland-fish'), function (node) {
    return { node: node, routes: waterRoutes[node.dataset.water], pending: null, lastRoute: null };
  });

  function canSwim() {
    return !document.hidden && !motion.matches && stage.dataset.page === 'home' &&
      !stage.classList.contains('woodland-view');
  }

  // Stagger starts and avoid repeating the route the fish just used.
  function schedule(swimmer, minimum, spread) {
    swimmer.pending = setTimeout(function () {
      swimmer.pending = null;
      if (!canSwim()) return;
      var options = swimmer.routes.filter(function (route) { return route !== swimmer.lastRoute; });
      swimmer.lastRoute = options[Math.floor(Math.random() * options.length)];
      swimmer.node.style.setProperty('--swim-time', (4.5 + 2.5 * Math.random()).toFixed(2) + 's');
      swimmer.node.dataset.route = swimmer.lastRoute;
    }, minimum + Math.random() * spread);
  }

  // Cancel timers and active paths when Home is hidden or reduced motion is enabled.
  function sync() {
    var active = canSwim();
    fish.forEach(function (swimmer, index) {
      if (active) {
        if (swimmer.pending == null && !swimmer.node.dataset.route) schedule(swimmer, 1000 + index * 650, 650);
      } else {
        clearTimeout(swimmer.pending);
        swimmer.pending = null;
        delete swimmer.node.dataset.route;
      }
    });
  }

  fish.forEach(function (swimmer) {
    swimmer.node.addEventListener('animationend', function () {
      delete swimmer.node.dataset.route;
      if (canSwim()) schedule(swimmer, 3400, 7000);
    });
  });
  new MutationObserver(sync).observe(stage, {
    attributes: true,
    attributeFilter: ['data-page', 'class'],
  });
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  sync();
}());

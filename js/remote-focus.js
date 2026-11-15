// Moves focus by screen position and draws a shared focus ring.
(function (root) {
  'use strict';
  var stage = document.getElementById('stage');
  var ring = document.getElementById('focus-ring');
  var reduced = root.matchMedia('(prefers-reduced-motion: reduce)');
  var cached, homeNodes, frame;

  function invalidate() { cached = null; homeNodes = null; }

  // Cache Home targets for repeated D-pad presses and skip hidden or disabled controls.
  function nodes(container, cacheHome) {
    if (cacheHome && homeNodes) return homeNodes;
    var list = Array.prototype.filter.call(container.querySelectorAll('button, a[href], input'), function (node) {
      return !node.disabled && node.getClientRects().length > 0;
    });
    if (cacheHome) homeNodes = list;
    return list;
  }

  // Prefer aligned targets, then an explicit panel target, then the best diagonal match.
  function nearest(nodes, current, direction, panelTarget) {
    var horizontal = direction === 'left' || direction === 'right';
    var forward = direction === 'right' || direction === 'down';
    var primaryStart = horizontal ? 'left' : 'top', primaryEnd = horizontal ? 'right' : 'bottom';
    var crossStart = horizontal ? 'top' : 'left', crossEnd = horizontal ? 'bottom' : 'right';
    var rects;
    // Reuse measured Home rectangles until a render or layout change invalidates them.
    if (nodes === homeNodes) {
      if (!cached) cached = nodes.map(function (node) { return node.getBoundingClientRect(); });
      rects = cached;
    } else rects = nodes.map(function (node) { return node.getBoundingClientRect(); });
    var origin = rects[nodes.indexOf(current)];
    var originPrimary = (origin[primaryStart] + origin[primaryEnd]) / 2;
    var originCross = (origin[crossStart] + origin[crossEnd]) / 2;
    var aligned, alignedScore = Infinity, diagonal, diagonalScore = Infinity;
    nodes.forEach(function (node, index) {
      if (node === current) return;
      var rect = rects[index];
      var primaryCenter = ((rect[primaryStart] + rect[primaryEnd]) / 2 - originPrimary) * (forward ? 1 : -1);
      if (primaryCenter <= 1) return;
      var primaryGap = Math.max(0, forward ? rect[primaryStart] - origin[primaryEnd] : origin[primaryStart] - rect[primaryEnd]);
      var crossGap = Math.max(0, origin[crossStart] - rect[crossEnd], rect[crossStart] - origin[crossEnd]);
      var crossCenter = Math.abs((rect[crossStart] + rect[crossEnd]) / 2 - originCross);
      var score = primaryGap + .1 * primaryCenter + 2 * crossGap + .18 * crossCenter;
      if (crossGap <= 1) {
        if (score < alignedScore) { alignedScore = score; aligned = node; }
      } else {
        score += 90 * crossCenter / (primaryCenter + 24);
        if (score < diagonalScore) { diagonalScore = score; diagonal = node; }
      }
    });
    return aligned || panelTarget || diagonal;
  }

  // Convert viewport measurements to stage coordinates and hide the ring outside scroll bounds.
  function place() {
    frame = null;
    var target = document.activeElement;
    if (!stage.contains(target) || !target.matches('button, a[href], input') || !target.getClientRects().length) {
      ring.hidden = true;
      return;
    }
    var bounds = stage.getBoundingClientRect(), rect = target.getBoundingClientRect();
    if (!bounds.width) return;
    var scale = bounds.width / stage.offsetWidth;
    var clip = target.closest('.scroll-area, #modal');
    if (clip) {
      var viewport = clip.getBoundingClientRect();
      if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) { ring.hidden = true; return; }
    }
    var x = (rect.left - bounds.left) / scale + stage.scrollLeft - 5;
    var y = (rect.top - bounds.top) / scale + stage.scrollTop - 5;
    var width = Math.round(rect.width / scale + 10) + 'px';
    var height = Math.round(rect.height / scale + 10) + 'px';
    if (ring.style.width !== width) ring.style.width = width;
    if (ring.style.height !== height) ring.style.height = height;
    ring.style.transform = 'translate3d(' + Math.round(x) + 'px, ' + Math.round(y) + 'px, 0)';
    ring.hidden = false;
  }

  function schedulePlace() { if (frame == null) frame = requestAnimationFrame(place); }

  // Scroll only the containing panel when its focused control needs more room.
  function focus(node) {
    node.focus({ preventScroll: true });
    var scroller = node.closest('.scroll-area, #modal');
    if (!scroller) return;
    var view = scroller.getBoundingClientRect(), rect = node.getBoundingClientRect();
    var scale = stage.getBoundingClientRect().width / stage.offsetWidth;
    var offset = rect.top < view.top + 10 ? rect.top - view.top - 10 : Math.max(0, rect.bottom - view.bottom + 10);
    if (offset) scroller.scrollBy({ top: offset / scale, behavior: reduced.matches ? 'auto' : 'smooth' });
  }

  document.addEventListener('focusin', schedulePlace);
  document.addEventListener('focusout', schedulePlace);
  stage.addEventListener('scroll', schedulePlace, true);
  root.addEventListener('resize', function () { invalidate(); schedulePlace(); });
  root.FrameRemoteFocus = { nodes: nodes, nearest: nearest, focus: focus, invalidate: invalidate };
}(window));

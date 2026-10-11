/* Micro-motion: scroll reveals (staggered), GPU-only, reduced-motion safe */
(function () {
  document.documentElement.classList.add('js');
  var SEL = '.hero > div, .demo-stage, .flow-card, .trust .cats span, .steps > div, .rev, .plan, .cta, .why-grid > div';
  var els = Array.prototype.slice.call(document.querySelectorAll(SEL));
  if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
  els.forEach(function (el) { el.setAttribute('data-rv', ''); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      // stagger siblings sharing a parent
      var sibs = Array.prototype.filter.call(el.parentNode.children, function (c) { return c.hasAttribute && c.hasAttribute('data-rv'); });
      var i = sibs.indexOf(el);
      el.style.transitionDelay = Math.min(i, 6) * 70 + 'ms';
      el.classList.add('in');
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach(function (e) { io.observe(e); });
})();

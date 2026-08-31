/* Shared page behaviour. Inlined at render time, no external request.
   Pages opt in by markup alone: every block below no-ops if its nodes are absent. */
(function () {
  'use strict';

  var CFG = {};
  try { CFG = JSON.parse(document.getElementById('page-config').textContent) || {}; } catch (e) {}

  var PREVIEW = CFG.PREVIEW_MODE === true;
  var PREVIEW_PATH = '/preview-checkout';
  var VARIANT = CFG.VARIANT || '';
  var ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid'];

  function withAttribution(raw) {
    if (!raw) return raw;
    try {
      var u = new URL(raw, location.href);
      var incoming = new URL(location.href);
      ATTRIBUTION_KEYS.forEach(function (key) {
        if (incoming.searchParams.has(key)) u.searchParams.set(key, incoming.searchParams.get(key));
      });
      return raw.charAt(0) === '/' ? u.pathname + u.search + u.hash : u.toString();
    } catch (e) {
      return raw;
    }
  }

  /**
   * Preview links retain the full attribution payload so review navigation can
   * be verified without creating a Checkout Session.
   */
  function withVariant(raw) {
    if (!raw || !VARIANT) return raw;
    try {
      var u = new URL(raw, location.href);
      u.searchParams.set('passthrough[variant]', VARIANT);
      u.searchParams.set('utm_content', 'variant-' + VARIANT);
      return raw.charAt(0) === '/' ? u.pathname + u.search + u.hash : u.toString();
    } catch (e) {
      return raw;
    }
  }

  function previewTarget() {
    return withVariant(withAttribution(PREVIEW_PATH));
  }

  function attribution() {
    var incoming = new URL(location.href);
    var values = { variant: VARIANT, utm_content: VARIANT ? 'variant-' + VARIANT : '' };
    ATTRIBUTION_KEYS.forEach(function (key) {
      if (incoming.searchParams.has(key)) values[key] = incoming.searchParams.get(key);
    });
    return values;
  }

  function checkout(kind) {
    var key = 'yfbjj_checkout_' + kind;
    var idempotencyKey = '';
    try {
      idempotencyKey = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, idempotencyKey);
    } catch (_) {
      idempotencyKey = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    }
    return fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ offer: kind, attribution: attribution() })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok || !payload.url) throw new Error(payload.error || 'checkout_failed');
        return payload.url;
      });
    });
  }

  /* ------------------------------------------------------------- prices */
  function money(cents) {
    var n = parseInt(cents, 10);
    if (!isFinite(n)) return null;
    return '$' + (n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2));
  }
  var PRICES = { bundle: money(CFG.BUNDLE_PRICE_CENTS) };
  [].forEach.call(document.querySelectorAll('[data-price]'), function (el) {
    var v = PRICES[el.getAttribute('data-price')];
    if (v) el.textContent = v;
  });

  /* ----------------------------------------------------------- deadline */
  // Rendered only from OFFER_DEADLINE. No deadline set, no deadline shown.
  (function () {
    var box = document.getElementById('deadline');
    if (!box || !CFG.OFFER_DEADLINE) return;
    var when = new Date(CFG.OFFER_DEADLINE);
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) return;
    var slot = box.querySelector('[data-deadline-text]');
    if (slot) {
      slot.textContent = when.toLocaleString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
      });
    }
    box.hidden = false;
  })();

  /* ----------------------------------------------------- preview banner */
  (function () {
    var banner = document.getElementById('preview-banner');
    if (banner && PREVIEW) banner.hidden = false;
  })();

  /* --------------------------------------------------------- cart links */
  var ctas = [].slice.call(document.querySelectorAll('[data-cart]'));
  // The href stays on the mutation-free preview page as a fail-closed fallback.
  // Live Stripe Checkout starts only through the guarded POST below.
  ctas.forEach(function (el) { el.setAttribute('href', previewTarget()); });

  /* -------------------------------------------------------- lead capture */
  var form = document.getElementById('lead-form');
  var captured = false;

  function remember(email) { try { sessionStorage.setItem('yfbjj_email', email); } catch (_) {} }
  function recall() { try { return sessionStorage.getItem('yfbjj_email') || ''; } catch (_) { return ''; } }

  function capture(email, source) {
    // Preview has no D1 by design. Skip the request so the review flow stays
    // mutation-free without generating a failed-resource console error.
    if (PREVIEW || captured || !email) return Promise.resolve();
    return fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, source: source, variant: VARIANT })
    }).then(function (res) { if (res.ok) captured = true; })
      .catch(function () { /* the sale never waits on our storage */ });
  }

  if (form) {
    var input = document.getElementById('email');
    var button = document.getElementById('lead-submit');
    var msg = document.getElementById('lead-msg');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!email || email.indexOf('@') < 1) {
        msg.textContent = 'Enter a valid email address.';
        msg.dataset.state = 'error';
        input.focus();
        return;
      }
      button.disabled = true;
      msg.textContent = '';
      msg.dataset.state = '';
      remember(email);

      // Capture, then hand off. A slow network, a failure, or a 429 from the
      // rate limiter must never hold a buyer on this page: 1.5s hard cap.
      var wait = new Promise(function (r) { setTimeout(r, 1500); });
      Promise.race([capture(email, 'landing-hero'), wait]).then(function () {
        if (PREVIEW) return previewTarget();
        return checkout('bundle');
      }).then(function (url) {
        location.assign(url);
      }).catch(function () {
        button.disabled = false;
        msg.textContent = 'Checkout is not ready yet. Please try again shortly.';
        msg.dataset.state = 'error';
      });
    });
  }

  // Secondary CTAs: send the address we already have, then hand off.
  ctas.forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (PREVIEW) return;
      e.preventDefault();
      var stored = recall();
      var wait = new Promise(function (r) { setTimeout(r, 800); });
      var lead = stored && !captured
        ? Promise.race([capture(stored, el.getAttribute('data-source') || 'secondary-cta'), wait])
        : Promise.resolve();
      lead.then(function () { return checkout(el.getAttribute('data-cart')); })
        .then(function (url) { location.assign(url); })
        .catch(function () { location.assign(previewTarget()); });
    });
  });

  /* ---------------------------------------------------------- buy bar */
  // Appears once the hero CTA is off screen, so the offer is always one tap away.
  (function () {
    var bar = document.getElementById('buybar');
    var hero = document.getElementById('hero');
    if (!bar || !hero || !('IntersectionObserver' in window)) return;
    document.body.setAttribute('data-buybar', 'on');
    new IntersectionObserver(function (entries) {
      bar.setAttribute('data-visible', entries[0].isIntersecting ? 'false' : 'true');
    }, { rootMargin: '-80px 0px 0px 0px' }).observe(hero);
  })();
})();

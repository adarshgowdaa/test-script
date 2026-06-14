/**
 * Gnani.ai — Home-Page Demo Form Call Trigger
 *
 * Standalone script. Add to the page where #wf-form-Demo-Form-home-page lives:
 *   <script src="call-trigger.js" defer></script>
 *
 * Independent of the playground script.js — they share no globals.
 */


/* ═══════════════════════════════════════════════════════════════════
 *  HOME-PAGE DEMO FORM — TRIGGER A CALL
 *
 *  Form  : #wf-form-Demo-Form-home-page
 *  Flow  : user picks use case → enters name + Indian phone →
 *          submits → POST to genbots/website_trigger_call/{botId}
 *
 *  Bot mapping (use-case label → bot ID):
 *    Collections          → Debt Collection V2
 *    Order Tracking       → Order_tracking_Latest
 *    Onboarding           → Appointment Booking Healthcare
 *    Lead Qualifications  → Lead qualification bot
 *
 *  Behaviour ported from the old initIndianPhoneCallTrigger():
 *    - India-only (+91), 10-digit validation
 *    - 5 calls per 10 minutes per browser (localStorage)
 *    - Button state: is-loading / is-success / is-failure
 *    - Auto-resets button after 3 s
 * ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  /* ── Use-case → bot ID ─────────────────────────────────────────── */
  var BOT_MAP = {
    'Collections'         : '5724e6dc3ee048859cc1842f5354d469', // Debt Collection V2
    'Order Tracking'      : '63bb9f010b834e0cbb2660ccb411c40c', // Order_tracking_Latest
    'Onboarding'          : 'b7dcd2c1c0fc4eee910a3c12c822eef4', // Appointment Booking Healthcare
    'Lead Qualifications' : 'ab752538f3c842699ada19e0790f32dd', // Lead qualification bot
  };

  /* ── Elements ──────────────────────────────────────────────────── */
  var form        = document.getElementById('wf-form-Demo-Form-home-page');
  if (!form) { console.warn('[Demo Form] #wf-form-Demo-Form-home-page not found'); return; }

  var useCaseSel  = form.querySelector('#use-case');
  var nameInput   = form.querySelector('#name');
  var phoneInput  = form.querySelector('#phone-number');
  var submitBtn   = form.querySelector('input[type="submit"]');

  if (!useCaseSel || !nameInput || !phoneInput || !submitBtn) {
    console.warn('[Demo Form] Missing required form fields');
    return;
  }

  /* ── Slim the use-case dropdown down to only mapped options ────── */
  // Per spec: skip KYC and Sales, replace Customer Support with Order Tracking
  var allowed = Object.keys(BOT_MAP); // [Collections, Order Tracking, Onboarding, Lead Qualifications]

  // Build new option list, preserving the empty placeholder
  var existingOptions = Array.prototype.slice.call(useCaseSel.options);
  useCaseSel.innerHTML = '';

  // Placeholder
  var placeholder = document.createElement('option');
  placeholder.value       = '';
  placeholder.textContent = 'Select your use case';
  useCaseSel.appendChild(placeholder);

  // Add the 4 allowed in order
  allowed.forEach(function (label) {
    var opt = document.createElement('option');
    opt.value       = label;
    opt.textContent = label;
    useCaseSel.appendChild(opt);
  });

  console.log('[Demo Form] Use-case options:', allowed);

  /* ── Rate limiting (5 calls / 10 min, per browser) ─────────────── */
  var RATE_KEY  = 'demoFormRateLimit';
  var MAX_CALLS = 5;
  var WINDOW_MS = 10 * 60 * 1000;

  function getRateState() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(RATE_KEY)); } catch (_) { raw = null; }
    var data = raw || { count: 0, timestamp: 0 };
    if (Date.now() - data.timestamp > WINDOW_MS) {
      data = { count: 0, timestamp: 0 };
      localStorage.removeItem(RATE_KEY);
    }
    return data;
  }

  function bumpRateState() {
    var data = getRateState();
    if (data.count === 0) data.timestamp = Date.now();
    data.count++;
    localStorage.setItem(RATE_KEY, JSON.stringify(data));
  }

  /* ── Submit handler ────────────────────────────────────────────── */
  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (submitBtn.classList.contains('is-loading')) return;

    var useCase = useCaseSel.value;
    var name    = nameInput.value.trim();
    var phone   = phoneInput.value.replace(/\D/g, ''); // strip non-digits

    // ── Validation ────────────────────────────────────────────────
    if (!useCase) {
      console.warn('[Demo Form] No use case selected');
      useCaseSel.focus();
      return;
    }
    if (!name) {
      console.warn('[Demo Form] Name required');
      nameInput.focus();
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      console.warn('[Demo Form] Invalid phone — expected 10 digits, got:', phone);
      phoneInput.focus();
      return;
    }

    // ── Bot lookup ────────────────────────────────────────────────
    var botId = BOT_MAP[useCase];
    if (!botId) {
      console.error('[Demo Form] No bot mapped for use case:', useCase);
      return;
    }

    // ── Rate limit ────────────────────────────────────────────────
    var rate = getRateState();
    if (rate.count >= MAX_CALLS) {
      var minsLeft = Math.ceil((WINDOW_MS - (Date.now() - rate.timestamp)) / 60000);
      console.warn('[Demo Form] Rate limit reached. Try again in ~' + minsLeft + ' min');
      submitBtn.classList.add('is-failure');
      setTimeout(function () { submitBtn.classList.remove('is-failure'); }, 3000);
      return;
    }

    // ── Fire the API call ─────────────────────────────────────────
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    submitBtn.classList.remove('is-success', 'is-failure');

    var apiUrl = 'https://api.inya.ai/genbots/website_trigger_call/' + botId;

    try {
      var res = await fetch(apiUrl, {
        method  : 'POST',
        headers : {
          'accept'      : 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          phone       : phone,
          name        : name,
          countryCode : '+91',  // India only
        }),
      });

      if (!res.ok) {
        var errText = await res.text().catch(function () { return res.statusText; });
        throw new Error('HTTP ' + res.status + ': ' + errText);
      }

      console.log('[Demo Form] Call triggered for', name, '+91' + phone, 'with bot', botId);
      submitBtn.classList.add('is-success');
      bumpRateState();

      // Optional — clear inputs on success
      // useCaseSel.value = ''; nameInput.value = ''; phoneInput.value = '';

    } catch (err) {
      console.error('[Demo Form] Trigger failed:', err);
      submitBtn.classList.add('is-failure');

    } finally {
      submitBtn.classList.remove('is-loading');
      setTimeout(function () {
        submitBtn.classList.remove('is-success', 'is-failure');
        submitBtn.disabled = false;
      }, 3000);
    }
  });

  console.log('[Demo Form] Ready ✓ — India-only, 4 use cases, 5 calls/10 min');
});
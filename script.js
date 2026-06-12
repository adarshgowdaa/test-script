/**
 * Gnani.ai API Playground
 *
 * Tab 1 — Speech to Text   : WebSocket streaming ASR
 * Tab 2 — Text to Speech   : REST generate + Web Audio playback
 * Tab 3 — Voice Agent      : GnaniWebVoice bidirectional WS
 */


/* ═══════════════════════════════════════════════════════════════════
 *  TAB SWITCHER
 *  Webflow's webflow.js handles this on the published site.
 *  This polyfill makes it work everywhere else (local, staging, etc.)
 * ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
    'use strict';
  
    const tabLinks = document.querySelectorAll('.api_tab-menu .api_tab-link[data-w-tab]');
    const tabPanes = document.querySelectorAll('.w-tab-content .w-tab-pane[data-w-tab]');
  
    if (!tabLinks.length) { console.warn('[Tabs] No tab links found'); return; }
  
    function switchTab(targetTabId) {
      // ── Links ──────────────────────────────────────────────────────
      tabLinks.forEach(link => {
        const isTarget = link.getAttribute('data-w-tab') === targetTabId;
        link.classList.toggle('w--current', isTarget);
        link.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        // Webflow sets tabindex="-1" on inactive tabs
        if (isTarget) link.removeAttribute('tabindex');
        else          link.setAttribute('tabindex', '-1');
      });
  
      // ── Panes ──────────────────────────────────────────────────────
      tabPanes.forEach(pane => {
        const isTarget = pane.getAttribute('data-w-tab') === targetTabId;
        if (isTarget) {
          pane.classList.add('w--tab-active');
          pane.style.display  = '';      // let CSS take over
          pane.style.opacity  = '1';
        } else {
          pane.classList.remove('w--tab-active');
          pane.style.display  = 'none';
          pane.style.opacity  = '0';
        }
      });
  
      console.log('[Tabs] Switched to', targetTabId);
    }
  
    tabLinks.forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        switchTab(this.getAttribute('data-w-tab'));
      });
    });
  
    // Initialise: make sure the DOM reflects whichever tab has w--current on load
    const activeLink = document.querySelector('.api_tab-link.w--current[data-w-tab]');
    if (activeLink) switchTab(activeLink.getAttribute('data-w-tab'));
  
    console.log('[Tabs] Switcher ready ✓ —', tabLinks.length, 'tabs found');
  });
  
  
  /* ═══════════════════════════════════════════════════════════════════
   *  TAB 1 — SPEECH TO TEXT
   *  wss://vachana-appdevbk.gnani.site/platform/services/asr/stream
   * ═══════════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    'use strict';
  
    const STT_WS_BASE  = 'wss://vachana-appdevbk.gnani.site/platform/services/asr/stream';
    const SAMPLE_RATE  = 16000;
    const BUFFER_SIZE  = 4096;
    const MAX_DURATION = 30_000;
  
    const STT_LANG_MAP = {
      English  : 'en-IN',
      Hindi    : 'hi-IN',
      Tamil    : 'ta-IN',
      Bengali  : 'bn-IN',
      Marathi  : 'mr-IN',
      Kannada  : 'kn-IN',
      Telugu   : 'te-IN',
      Gujarati : 'gu-IN',
      Punjabi  : 'pa-IN',
      Malayalam: 'ml-IN',
    };
  
    const elMic        = document.getElementById('st-speak-now');
    const elWave       = document.getElementById('st-listen');
    const elReset      = document.getElementById('st-start-again');
    const elStarting   = document.getElementById('st-starting');   // new "Starting…" ring
    const elTextarea   = document.getElementById('field');
    const elLangSelect = document.getElementById('St-Language');
  
    const missing = ['st-speak-now','st-listen','st-start-again','field','St-Language']
      .filter(id => !document.getElementById(id));
    if (missing.length) { console.error('[STT] Missing elements:', missing); return; }
    console.log('[STT] DOM ready ✓');
  
    const show = el => { if (el) { el.style.opacity = '1'; el.style.display = 'flex'; } };
    const hide = el => { if (el) el.style.display = 'none'; };
  
    let currentState    = 'idle';
    let audioContext    = null;
    let scriptProcessor = null;
    let sourceNode      = null;
    let micStream       = null;
    let websocket       = null;
    let autoStopTimer   = null;
    let transcriptParts = {};
  
    function setState(state) {
      currentState = state;
      console.log('[STT] state →', state);
      switch (state) {
        case 'idle':
          hide(elStarting); show(elMic); show(elWave);
          elTextarea.value = ''; elTextarea.placeholder = 'Example Text';
          elTextarea.disabled = false;
          break;
        case 'connecting':
          hide(elMic); hide(elWave); show(elStarting);
          elTextarea.value = ''; elTextarea.placeholder = 'Starting…';
          elTextarea.disabled = true;
          break;
        case 'recording':
          hide(elMic); hide(elStarting); show(elWave);
          elTextarea.placeholder = 'Listening…';
          elTextarea.disabled = false;
          break;
        case 'processing':
          hide(elMic); hide(elWave); hide(elStarting);
          elTextarea.placeholder = 'Finishing transcription…';
          elTextarea.disabled = true;
          break;
        case 'result':
          hide(elMic); hide(elWave); hide(elStarting);
          elTextarea.disabled = false;
          break;
        case 'error':
          hide(elStarting); show(elMic); show(elWave);
          elTextarea.disabled = false;
          break;
      }
    }
  
    async function startRecording() {
      console.log('[STT] startRecording');
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error('[STT] Mic denied:', err);
        alert('Microphone permission is required. Allow access and try again.');
        return;
      }
  
      setState('connecting');
      transcriptParts = {};
  
      const langCode = STT_LANG_MAP[elLangSelect.value] ?? 'en-IN';
      const wsUrl    = `${STT_WS_BASE}?language_code=${langCode}`;
      console.log('[STT] Opening WebSocket:', wsUrl);
  
      websocket = new WebSocket(wsUrl);
      websocket.binaryType = 'arraybuffer';
  
      websocket.onopen = () => {
        console.log('[STT] WS open');
        startAudioPipeline();
        setState('recording');
        autoStopTimer = setTimeout(stopRecording, MAX_DURATION);
      };
  
      websocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'transcript' && msg.text) {
            transcriptParts[msg.segment_index ?? 0] = msg.text;
            elTextarea.value = buildTranscript();
          }
        } catch (_) {}
      };
  
      websocket.onerror = (err) => {
        console.error('[STT] WS error:', err);
        sttCleanup();
        elTextarea.placeholder = 'Connection error. Try again.';
        setState('error');
      };
  
      websocket.onclose = (event) => {
        console.log('[STT] WS closed — code:', event.code);
        sttCleanup();
        if (currentState === 'recording' || currentState === 'processing') {
          const t = buildTranscript();
          if (t) { elTextarea.value = t; setState('result'); }
          else   { elTextarea.placeholder = 'No speech detected. Try again.'; setState('error'); }
        }
      };
    }
  
    function stopRecording() {
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      stopAudioPipeline();
      setState('processing');
      if (websocket && websocket.readyState === WebSocket.OPEN)
        websocket.close(1000, 'Recording complete');
    }
  
    function sttReset() {
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      stopAudioPipeline();
      if (websocket) {
        websocket.onclose = null;
        if (websocket.readyState !== WebSocket.CLOSED) websocket.close();
        websocket = null;
      }
      transcriptParts = {};
      setState('idle');
    }
  
    function startAudioPipeline() {
      audioContext    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      sourceNode      = audioContext.createMediaStreamSource(micStream);
      scriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
        const int16 = float32ToInt16(e.inputBuffer.getChannelData(0));
        websocket.send(int16.buffer);
      };
      sourceNode.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      console.log('[STT] Audio pipeline @ ', audioContext.sampleRate, 'Hz');
    }
  
    function stopAudioPipeline() {
      if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null; }
      if (sourceNode)      { sourceNode.disconnect();      sourceNode      = null; }
      if (audioContext)    { audioContext.close();          audioContext    = null; }
      if (micStream)       { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    }
  
    function sttCleanup() {
      stopAudioPipeline();
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
    }
  
    function float32ToInt16(f32) {
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        i16[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return i16;
    }
  
    function buildTranscript() {
      return Object.keys(transcriptParts)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => transcriptParts[k]).join(' ').trim();
    }
  
    elMic  .addEventListener('click', startRecording);
    elWave .addEventListener('click', stopRecording);
    elReset.addEventListener('click', sttReset);
  
    setState('idle');
    console.log('[STT] Ready ✓');
  });
  
  
  /* ═══════════════════════════════════════════════════════════════════
   *  TAB 2 — TEXT TO SPEECH
   *  POST https://vachana-appdevbk.gnani.site/platform/services/tts/generate-audio
   *  Response: { audio: "<base64>", voice_id: "Karan" }
   *
   *  States:
   *    idle     → ts-generate visible
   *    loading  → ts-loading visible (API in flight)
   *    ready    → ts-play + ts-start-again + ts-tone visible
   *    playing  → ts-playing (with pause/stop) + ts-start-again + ts-tone
   *    paused   → ts-playing (play icon swapped) + ts-start-again + ts-tone
   *    error    → ts-generate visible
   * ═══════════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    'use strict';
  
    const TTS_ENDPOINT = 'https://vachana-appdevbk.gnani.site/platform/services/tts/generate-audio';
  
    const TTS_LANG_MAP = {
      English  : 'en-IN',
      Hindi    : 'hi-IN',
      Tamil    : 'ta-IN',
      Bengali  : 'bn-IN',
      Marathi  : 'mr-IN',
      Kannada  : 'kn-IN',
      Telugu   : 'te-IN',
      Gujarati : 'gu-IN',
      Punjabi  : 'pa-IN',
      Malayalam: 'ml-IN',
    };
  
    /* ── Elements ──────────────────────────────────────────────────── */
    const elGenerate   = document.getElementById('ts-generate');    // CTA ring
    const elLoading    = document.getElementById('ts-loading');     // spinner ring
    const elTsPlay     = document.getElementById('ts-play');        // play ring
    const elPlaying    = document.getElementById('ts-playing');     // playing ring (has pause/stop inside)
    const elStartAgain = document.getElementById('ts-start-again'); // reset ring
    const elInput      = document.getElementById('ts-input');
    const elLangSelect = document.getElementById('Ts-Language');
    const elTone       = document.getElementById('ts-tone');        // voice info row
    const elToneName   = document.getElementById('ts_tone-name');
  
    // Controls inside the playing ring
    const elApiTsPause = document.getElementById('api_ts-pause');   // pause icon (img)
    const elApiTsPlay  = document.getElementById('api_ts-play');    // play icon  (img)
    const elApiTsStop  = document.getElementById('api_ts-stop');    // "Stop" text
    const elApiTsStops = document.getElementById('api_ts-stops');   // stop icon  (img)
  
    const required = ['ts-generate','ts-loading','ts-play','ts-playing',
                      'ts-start-again','ts-input','Ts-Language'];
    const missing  = required.filter(id => !document.getElementById(id));
    if (missing.length) { console.error('[TTS] Missing elements:', missing); return; }
    console.log('[TTS] DOM ready ✓');
  
    /* ── Helpers ───────────────────────────────────────────────────── */
    const showFlex  = el => { if (el) el.style.display = 'flex'; };
    const showBlock = el => { if (el) el.style.display = 'block'; };
    const hide      = el => { if (el) el.style.display = 'none'; };
  
    /* ── State ─────────────────────────────────────────────────────── */
    let ttsAudioBuf  = null;
    let ttsAudioCtx  = null;
    let ttsSrcNode   = null;
    let ttsStartTime = 0;
    let ttsPauseAt   = 0;        // seconds into buffer where we paused
    let ttsIsPlaying = false;
  
    function setTtsState(state) {
      console.log('[TTS] state →', state);
  
      // Hide all rings first
      hide(elGenerate); hide(elLoading); hide(elTsPlay);
      hide(elPlaying);  hide(elStartAgain); hide(elTone);
  
      switch (state) {
        case 'idle':
          showFlex(elGenerate);
          elInput.disabled = false;
          break;
  
        case 'loading':
          showFlex(elLoading);
          elInput.disabled = true;
          break;
  
        case 'ready':
          showFlex(elTsPlay);
          showFlex(elStartAgain);
          showFlex(elTone);
          elInput.disabled = false;
          ttsPauseAt = 0;
          break;
  
        case 'playing':
          showFlex(elPlaying);
          showFlex(elStartAgain);
          showFlex(elTone);
          // Inside playing ring: show pause, hide play
          showBlock(elApiTsPause);
          hide(elApiTsPlay);
          break;
  
        case 'paused':
          showFlex(elPlaying);
          showFlex(elStartAgain);
          showFlex(elTone);
          // Inside playing ring: show play, hide pause
          hide(elApiTsPause);
          showBlock(elApiTsPlay);
          break;
  
        case 'error':
          showFlex(elGenerate);
          elInput.disabled = false;
          break;
      }
    }
  
    /* ── Generate ──────────────────────────────────────────────────── */
    async function generateTTS() {
      const text = elInput.value.trim();
      if (!text) { elInput.focus(); return; }
  
      setTtsState('loading');
      ttsAudioBuf = null;
      ttsPauseAt  = 0;
  
      const langCode = TTS_LANG_MAP[elLangSelect.value] ?? 'en-IN';
      const form     = new FormData();
      form.append('text', text);
      form.append('language_code', langCode);
  
      try {
        const res = await fetch(TTS_ENDPOINT, { method: 'POST', body: form });
  
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }
  
        const data = await res.json();
        console.log('[TTS] voice_id:', data.voice_id);
        if (!data.audio) throw new Error('No audio in response');
  
        // Show voice name in tone badge
        if (elToneName) elToneName.textContent = data.voice_id || 'Voice';
  
        // Decode base64 → ArrayBuffer → AudioBuffer
        const arrayBuf  = base64ToArrayBuffer(data.audio);
        ttsAudioCtx     = getAudioCtx();
        ttsAudioBuf     = await ttsAudioCtx.decodeAudioData(arrayBuf);
  
        setTtsState('ready');
  
      } catch (err) {
        console.error('[TTS] Error:', err);
        setTtsState('error');
      }
    }
  
    /* ── Play ──────────────────────────────────────────────────────── */
    function playTTS() {
      if (!ttsAudioBuf) return;
      const ctx = getAudioCtx();
      stopSource(); // clear any existing source node
  
      const src = ctx.createBufferSource();
      src.buffer = ttsAudioBuf;
      src.connect(ctx.destination);
  
      const offset = ttsPauseAt || 0;
      src.start(0, offset);
      ttsStartTime = ctx.currentTime - offset;
      ttsIsPlaying = true;
      ttsSrcNode   = src;
      setTtsState('playing');
  
      src.onended = () => {
        if (ttsIsPlaying) {       // natural end (not pause/stop)
          ttsIsPlaying = false;
          ttsPauseAt   = 0;
          setTtsState('ready');   // back to ready so they can replay
        }
      };
    }
  
    /* ── Pause ─────────────────────────────────────────────────────── */
    function pauseTTS() {
      if (!ttsIsPlaying || !ttsSrcNode || !ttsAudioCtx) return;
      ttsPauseAt   = ttsAudioCtx.currentTime - ttsStartTime;
      ttsIsPlaying = false;
      stopSource();
      setTtsState('paused');
    }
  
    /* ── Stop (keeps audio, goes back to ready) ─────────────────────── */
    function stopTTS() {
      ttsIsPlaying = false;
      ttsPauseAt   = 0;
      stopSource();
      setTtsState('ready');
    }
  
    /* ── Reset (clears everything) ─────────────────────────────────── */
    function resetTTS() {
      ttsIsPlaying = false;
      ttsPauseAt   = 0;
      stopSource();
      ttsAudioBuf  = null;
      elInput.value = '';
      setTtsState('idle');
    }
  
    /* ── Helpers ───────────────────────────────────────────────────── */
    function stopSource() {
      if (ttsSrcNode) {
        ttsSrcNode.onended = null;
        try { ttsSrcNode.stop(); }       catch (_) {}
        try { ttsSrcNode.disconnect(); } catch (_) {}
        ttsSrcNode = null;
      }
    }
  
    function getAudioCtx() {
      if (!ttsAudioCtx || ttsAudioCtx.state === 'closed')
        ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (ttsAudioCtx.state === 'suspended') ttsAudioCtx.resume();
      return ttsAudioCtx;
    }
  
    function base64ToArrayBuffer(b64) {
      const raw  = window.atob(b64);
      const buf  = new ArrayBuffer(raw.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
      return buf;
    }
  
    /* ── Bind ──────────────────────────────────────────────────────── */
    elGenerate  .addEventListener('click', generateTTS);
    elTsPlay    .addEventListener('click', playTTS);
    elStartAgain.addEventListener('click', resetTTS);
  
    // Controls inside the playing ring
    if (elApiTsPause) elApiTsPause.addEventListener('click', pauseTTS);
    if (elApiTsPlay)  elApiTsPlay .addEventListener('click', playTTS);   // resume from pause
    if (elApiTsStop)  elApiTsStop .addEventListener('click', stopTTS);
    if (elApiTsStops) elApiTsStops.addEventListener('click', stopTTS);
  
    setTtsState('idle');
    console.log('[TTS] Ready ✓');
  });
  
  
  /* ═══════════════════════════════════════════════════════════════════
   *  VOICE AGENT — GnaniWebVoice
   *  Protocol: mic → µ-law base64 → WS, TTS PCM16 base64 ← WS
   * ═══════════════════════════════════════════════════════════════════ */
  
  var GnaniAudioUtils = (function () {
    var BIAS = 0x84, CLIP = 32635;
  
    function floatTo16BitPCM(f32) {
      var i16 = new Int16Array(f32.length);
      for (var i = 0; i < f32.length; i++) {
        var s = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return i16;
    }
  
    function linearToMuLaw(pcm) {
      var out = new Uint8Array(pcm.length);
      for (var i = 0; i < pcm.length; i++) {
        var sample = pcm[i], sign = (sample >> 8) & 0x80;
        if (sign) sample = -sample;
        if (sample > CLIP) sample = CLIP;
        sample += BIAS;
        var exp = 7;
        for (; exp > 0; exp--) { if (sample & 0x4000) break; sample <<= 1; }
        out[i] = ~(sign | (exp << 4) | ((sample >> 9) & 0x0f)) & 0xff;
      }
      return out;
    }
  
    function getBase64Audio(f32) {
      var mulaw = linearToMuLaw(floatTo16BitPCM(f32)), bin = '';
      for (var i = 0; i < mulaw.length; i++) bin += String.fromCharCode(mulaw[i]);
      return window.btoa(bin);
    }
  
    function base64ToPCM16(b64) {
      var raw = window.atob(b64), buf = new ArrayBuffer(raw.length), v = new Uint8Array(buf);
      for (var i = 0; i < raw.length; i++) v[i] = raw.charCodeAt(i);
      return new Int16Array(buf);
    }
  
    function pcm16ToFloat32(pcm16) {
      var out = new Float32Array(pcm16.length);
      for (var i = 0; i < pcm16.length; i++)
        out[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
      return out;
    }
  
    function resampleAudio(data, fromRate, toRate) {
      var ratio = toRate / fromRate, newLen = Math.floor(data.length * ratio),
          result = new Float32Array(newLen);
      for (var i = 0; i < newLen; i++) {
        var pos = i / ratio, idx = Math.floor(pos), frac = pos - idx;
        result[i] = idx >= data.length - 1
          ? data[data.length - 1]
          : data[idx] * (1 - frac) + data[idx + 1] * frac;
      }
      return result;
    }
  
    function createWorkletBlobURL(sr) {
      var code =
        'class AudioProcessor extends AudioWorkletProcessor {\n' +
        '  constructor(o){super();var s=(o.processorOptions&&o.processorOptions.sampleRate)||' + sr + ';\n' +
        '  this.bufferSize=Math.floor((s*400)/1000);this.buffer=new Float32Array(this.bufferSize);this.bufferIndex=0;}\n' +
        '  process(inputs){\n' +
        '    var inp=inputs[0];if(!inp||!inp[0])return true;\n' +
        '    var samples=inp[0];\n' +
        '    for(var i=0;i<samples.length;i++){\n' +
        '      this.buffer[this.bufferIndex++]=samples[i];\n' +
        '      if(this.bufferIndex>=this.bufferSize){\n' +
        '        this.port.postMessage({type:"audio-data",data:this.buffer.slice(),timestamp:currentTime});\n' +
        '        this.bufferIndex=0;}}\n' +
        '    return true;}}\n' +
        'registerProcessor("audio-processor",AudioProcessor);';
      return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    }
  
    return { getBase64Audio, base64ToPCM16, pcm16ToFloat32, resampleAudio, createWorkletBlobURL };
  })();
  
  
  function GnaniWebVoice(options) {
    var self = this;
    var SAMPLE_RATE = 44100, CHANNELS = 1, BUFFER_DURATION = 1;
    var bufferSize  = SAMPLE_RATE * CHANNELS * BUFFER_DURATION;
    var opts        = options || {};
    var websocketUrl   = opts.websocketUrl || '';
    var onOpen         = opts.onOpen  || function () {};
    var onClose        = opts.onClose || function () {};
    var onError        = opts.onError || function () {};
    var onTOT          = opts.onTOT   || function () {};
    var onEOT          = opts.onEOT   || function () {};
    var log = opts.logger || {
      info:  function () { console.log .apply(console, ['[GnaniWebVoice]'].concat([].slice.call(arguments))); },
      error: function () { console.error.apply(console, ['[GnaniWebVoice]'].concat([].slice.call(arguments))); }
    };
  
    var ws = null, micStream = null, audioCtx = null;
    var workletNode = null, workletSource = null;
    var scriptProcessor = null, scriptSource = null;
    var isCleanedUp = false, backendSampleRate = SAMPLE_RATE;
    var isStopReceived = false, lastSentTTSEvent = null;
    var audioBuffer = [], isPlayingAudio = false, currentSourceNode = null;
    self.isConnected = false; self.isPlaying = false;
  
    function getOrCreateAudioCtx() {
      if (!audioCtx || audioCtx.state === 'closed')
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' });
      return audioCtx;
    }
  
    function emitTTSPlaying(playing) {
      if (lastSentTTSEvent === playing || !ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ event: 'TTS_PLAYING', media: { tts_playing: playing } })); lastSentTTSEvent = playing; }
      catch (e) { log.error('Failed TTS_PLAYING:', e); }
    }
  
    function processAudioChunk(payload) {
      try {
        var f32 = GnaniAudioUtils.pcm16ToFloat32(GnaniAudioUtils.base64ToPCM16(payload));
        var resampled = (backendSampleRate === SAMPLE_RATE) ? f32
          : GnaniAudioUtils.resampleAudio(f32, backendSampleRate, SAMPLE_RATE);
        audioBuffer.push(resampled);
        var total = audioBuffer.reduce(function (s, c) { return s + c.length; }, 0);
        if (total >= bufferSize) playNextChunk();
      } catch (e) { log.error('processAudioChunk:', e); }
    }
  
    function playNextChunk() {
      var ctx = getOrCreateAudioCtx();
      if (!ctx || isPlayingAudio) return;
      var audioData;
      if (audioBuffer.length === 0) {
        isPlayingAudio = false; self.isPlaying = false; emitTTSPlaying(false);
        audioData = new Float32Array(Math.floor(backendSampleRate * BUFFER_DURATION * 2));
      } else {
        emitTTSPlaying(true); isPlayingAudio = true; self.isPlaying = true;
        var totalLen = 0, chunks = [];
        while (audioBuffer.length > 0 && totalLen < bufferSize) {
          var c = audioBuffer.shift(); chunks.push(c); totalLen += c.length;
        }
        audioData = new Float32Array(totalLen);
        for (var off = 0, i = 0; i < chunks.length; i++) { audioData.set(chunks[i], off); off += chunks[i].length; }
      }
      var buf = ctx.createBuffer(1, audioData.length, SAMPLE_RATE);
      buf.getChannelData(0).set(audioData);
      var source = ctx.createBufferSource();
      source.buffer = buf; source.connect(ctx.destination);
      source.onended = function () {
        isPlayingAudio = false;
        if (audioBuffer.length > 0) { playNextChunk(); }
        else { self.isPlaying = false; emitTTSPlaying(false); if (isStopReceived && ws) ws.close(); }
      };
      source.start(); currentSourceNode = source;
    }
  
    function processMessage(msg) {
      try {
        if (msg.event === 'media' && msg.media && msg.media.payload) {
          backendSampleRate = msg.sample_rate || SAMPLE_RATE; processAudioChunk(msg.media.payload);
        } else if (msg.event === 'user_transcript') {
          // User speech recognition — may stream interim then final
          if (typeof opts.onUserTranscript === 'function') opts.onUserTranscript(msg);
        } else if (msg.event === 'transcript') {
          // Agent reply (final, per turn)
          if (typeof opts.onAgentTranscript === 'function') opts.onAgentTranscript(msg);
        } else if (msg.event === 'barge' || msg.event === 'BARGE') {
          log.info('Barge — clearing TTS buffer'); audioBuffer = [];
        } else if (msg.event === 'EOC') {
          log.info('EOC'); if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'EOC' }));
        } else if (msg.event === 'stop') {
          log.info('Stop'); isStopReceived = true;
        } else if (msg.data === 'TOT') { log.info('TOT'); onTOT(); }
          else if (msg.data === 'EOT') { log.info('EOT'); onEOT(); }
          else                          { log.info('Unhandled:', msg); }
      } catch (e) { log.error('processMessage:', e); }
    }
  
    async function setupMicAndStream() {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: CHANNELS,
                 echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } }
      });
      var ctx     = getOrCreateAudioCtx();
      var micSrc  = ctx.createMediaStreamSource(micStream);
      var comp    = ctx.createDynamicsCompressor();
      comp.threshold.value = -30; comp.knee.value = 40; comp.ratio.value = 8;
      comp.attack.value = 0.002; comp.release.value = 0.1;
      var gain = ctx.createGain(); gain.gain.value = 1.2;
      micSrc.connect(comp).connect(gain);
  
      var workletLoaded = false;
      if (ctx.audioWorklet) {
        try {
          var blobUrl = GnaniAudioUtils.createWorkletBlobURL(ctx.sampleRate);
          await ctx.audioWorklet.addModule(blobUrl);
          URL.revokeObjectURL(blobUrl); workletLoaded = true;
        } catch (e) { log.info('AudioWorklet unavailable, using ScriptProcessor'); }
      }
  
      if (workletLoaded) {
        workletSource = ctx.createMediaStreamSource(micStream);
        workletNode   = new AudioWorkletNode(ctx, 'audio-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
          processorOptions: { sampleRate: ctx.sampleRate }
        });
        workletNode.port.onmessage = function (e) {
          if (ws && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ event: 'media', media: { payload: GnaniAudioUtils.getBase64Audio(e.data.data), timestamp: e.data.timestamp } }));
        };
        workletSource.connect(workletNode);
        log.info('Streaming via AudioWorklet @', ctx.sampleRate, 'Hz');
      } else {
        scriptSource    = ctx.createMediaStreamSource(micStream);
        scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = function (e) {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ event: 'media', media: { payload: GnaniAudioUtils.getBase64Audio(e.inputBuffer.getChannelData(0)), timestamp: e.playbackTime } }));
        };
        scriptSource.connect(scriptProcessor); scriptProcessor.connect(ctx.destination);
        log.info('Streaming via ScriptProcessor @', ctx.sampleRate, 'Hz');
      }
    }
  
    function stopProcessing() {
      if (workletNode)    { workletNode.disconnect();    workletNode    = null; }
      if (workletSource)  { workletSource.disconnect();  workletSource  = null; }
      if (scriptProcessor){ scriptProcessor.disconnect();scriptProcessor= null; }
      if (scriptSource)   { scriptSource.disconnect();   scriptSource   = null; }
    }
  
    function cleanup(source) {
      if (isCleanedUp) return; isCleanedUp = true;
      stopProcessing();
      if (ws) { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); ws = null; }
      if (audioCtx) { audioCtx.close(); audioCtx = null; }
      if (currentSourceNode) { try { currentSourceNode.stop(); } catch (_) {} try { currentSourceNode.disconnect(); } catch (_) {} currentSourceNode = null; }
      if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); t.enabled = false; }); micStream = null; }
      audioBuffer = []; isPlayingAudio = false; isStopReceived = false; lastSentTTSEvent = null;
      self.isPlaying = false; self.isConnected = false;
      onClose(source);
    }
  
    function openConnection(onSuccess) {
      if (!websocketUrl) { log.error('websocketUrl required'); return; }
      isCleanedUp = false; isStopReceived = false; lastSentTTSEvent = null;
      backendSampleRate = SAMPLE_RATE; audioBuffer = [];
  
      var socket = new WebSocket(websocketUrl); ws = socket;
      socket.onopen = async function () {
        if (isCleanedUp) { socket.close(); return; }
        self.isConnected = true; log.info('WS connected'); onOpen();
        try { await setupMicAndStream(); socket.send(JSON.stringify({ event: 'start' })); if (onSuccess) onSuccess(); }
        catch (e) { log.error('Mic setup failed:', e); onError(e); cleanup('client'); }
      };
      socket.onmessage = function (evt) {
        if (isCleanedUp) return;
        try { var d = JSON.parse(evt.data); if (d) processMessage(d); } catch (e) { log.error('Parse error:', e); }
      };
      socket.onclose = function (e) {
        if (e.reason === 'LINK_EXPIRED') { log.info('Link expired — reloading'); location.reload(); return; }
        if (!isCleanedUp) cleanup('server'); stopProcessing();
      };
      socket.onerror = function (e) { log.error('WS error:', e); onError(e); if (!isCleanedUp) cleanup('server'); };
    }
  
    self.connect    = function () { if (!ws && !isCleanedUp && !self.isConnected) openConnection(); };
    self.disconnect = function () { cleanup('client'); };
    self.reconnect  = function (cb) {
      if (ws) { ws.onclose = null; if (ws.readyState !== WebSocket.CLOSED) ws.close(); ws = null; }
      stopProcessing();
      if (audioCtx) { audioCtx.close(); audioCtx = null; }
      if (currentSourceNode) { try { currentSourceNode.stop(); } catch (_) {} try { currentSourceNode.disconnect(); } catch (_) {} currentSourceNode = null; }
      if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); t.enabled = false; }); micStream = null; }
      audioBuffer = []; isPlayingAudio = false; isStopReceived = false; lastSentTTSEvent = null;
      isCleanedUp = false; self.isConnected = false; self.isPlaying = false;
      openConnection(cb);
    };
    self.setWebsocketUrl = function (url) { websocketUrl = url; };
  }
  
  
  /* ═══════════════════════════════════════════════════════════════════
   *  TAB 3 — VOICE AGENT  (Webflow binding + chat UI)
   *
   *  Agent grouping strategy:
   *    Agent chunks often arrive in the same millisecond with different
   *    "turn" numbers (turn 2, 3, 4...). Each is logically part of ONE
   *    spoken reply. We merge them with a debounce: every chunk extends
   *    the same bubble, and the bubble only "closes" when either
   *      (a) the user speaks, or
   *      (b) AGENT_TURN_TIMEOUT ms pass with no new chunks
   *
   *  Marquee placeholders:
   *    Hidden immediately on page load with !important inline style,
   *    so the dummy bubbles never flash before the user connects.
   * ═══════════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    'use strict';
  
    var VA_WS_URL = 'wss://weborc.inya.ai/ws_speech_transcript/48852f1a89e84ce084b4e78c7130d257?api_key=89b7952e-796a-46f4-b18b-3f67434e58f7&mode=test&intent_id=flow123&conversation_id=d2ee6a45-ba0a-4cc8-a987-24a44dccd2ed&phone_number=0000000000&organization_id=0e56a0b7-a89b-4076-bf88-d2fece19e5a0&environment=production&language=en-US';
  
    // Time without new agent chunks before considering the turn complete
    var AGENT_TURN_TIMEOUT = 800; // ms
  
    var vaTakeBtn = document.getElementById('voice_take');
    var vaHangBtn = document.getElementById('voice-hang');
    var chatBox   = document.querySelector('.voice_infinite');
    var chatWrap  = document.querySelector('.voice_infinite-relative');
  
    if (!vaTakeBtn) { console.warn('[VA] #voice_take not found'); return; }
    if (!chatBox)   { console.warn('[VA] .voice_infinite not found'); return; }
  
    /* ── State ─────────────────────────────────────────────────────── */
    var currentBubble    = null;   // the bubble being actively appended to
    var currentRole      = null;   // 'user' or 'agent'
    var agentTurnTimer   = null;   // debounce timer for closing agent bubble
  
    /* ── Hide marquee placeholders RIGHT NOW, with !important ─────── */
    // Setting innerHTML='' isn't enough if Webflow re-renders. Lock down
    // every original child with inline display:none — permanently.
    // They are design previews only and should never be visible to users.
    function hidePlaceholders() {
      var children = chatBox.children;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        // Only hide originals (skip our own bubbles which have data-va-owned)
        if (!child.dataset || child.dataset.vaOwned !== '1') {
          child.style.setProperty('display', 'none', 'important');
        }
      }
      chatBox.style.setProperty('animation', 'none', 'important');
    }
  
    function clearOurBubbles() {
      // Remove only the bubbles we added; never restore placeholders.
      var children = chatBox.children;
      for (var i = children.length - 1; i >= 0; i--) {
        var child = children[i];
        if (child.dataset && child.dataset.vaOwned === '1') {
          child.remove();
        }
      }
    }
  
    hidePlaceholders(); // hide immediately on page load — stay hidden forever
  
    // Lock viewport height for scrolling once
    if (chatWrap && !chatWrap.dataset.vaHeightLocked) {
      chatWrap.style.overflowY = 'auto';
      chatWrap.style.maxHeight = (chatWrap.offsetHeight || 224) + 'px';
      chatWrap.dataset.vaHeightLocked = '1';
    }
  
    /* ── Language select enable / disable ──────────────────────────── */
    // Webflow's design adds class "is--disabled" + disabled attribute on
    // the language select during the call. We need to undo this on hang up
    // so the user can pick a different language for the next call.
    var langSelect = document.getElementById('voice-language');
  
    function disableLangSelect() {
      if (!langSelect) return;
      langSelect.disabled = true;
      langSelect.classList.add('is--disabled');
    }
  
    function enableLangSelect() {
      if (!langSelect) return;
      langSelect.disabled = false;
      langSelect.classList.remove('is--disabled');
    }
  
    // Make sure the select is enabled on page load (in case the design
    // markup ships with it disabled)
    enableLangSelect();
  
    function startConversation() {
      clearOurBubbles();      // clear any leftover bubbles from previous call
      hidePlaceholders();     // re-assert placeholder hiding
      currentBubble  = null;
      currentRole    = null;
      cancelAgentTimer();
      disableLangSelect();
    }
  
    function endConversation() {
      currentBubble  = null;
      currentRole    = null;
      cancelAgentTimer();
      enableLangSelect();
      // DO NOT touch our bubbles — keep the conversation history visible
      // for the user to read after they hang up. The placeholders stay hidden.
    }
  
    /* ── Bubble factory ────────────────────────────────────────────── */
    function makeBubble(role, text) {
      var wrap = document.createElement('div');
      wrap.className = 'voice_text-component is--' + role;
      wrap.dataset.vaOwned = '1';
      var inner = document.createElement('div');
      inner.textContent = text;
      wrap.appendChild(inner);
      return wrap;
    }
  
    function openBubble(role, text) {
      var bubble = makeBubble(role, text);
      chatBox.appendChild(bubble);
      currentBubble = bubble;
      currentRole   = role;
      scrollToBottom();
      return bubble;
    }
  
    function appendToBubble(text) {
      if (!currentBubble) return;
      var inner = currentBubble.firstChild;
      if (!inner) return;
      var existing = inner.textContent;
      inner.textContent = (existing + ' ' + text).replace(/\s+/g, ' ').trim();
      scrollToBottom();
    }
  
    function replaceBubbleText(text) {
      if (!currentBubble) return;
      var inner = currentBubble.firstChild;
      if (inner) inner.textContent = text;
      scrollToBottom();
    }
  
    function closeBubble() {
      currentBubble = null;
      currentRole   = null;
    }
  
    function scrollToBottom() {
      if (chatWrap)  chatWrap.scrollTop  = chatWrap.scrollHeight;
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  
    /* ── Agent turn debouncing ─────────────────────────────────────── */
    function startAgentTimer() {
      cancelAgentTimer();
      agentTurnTimer = setTimeout(function () {
        // No new agent chunks for AGENT_TURN_TIMEOUT — close the turn
        if (currentRole === 'agent') {
          console.log('[VA] Agent turn complete (timeout) — closing bubble');
          closeBubble();
        }
        agentTurnTimer = null;
      }, AGENT_TURN_TIMEOUT);
    }
  
    function cancelAgentTimer() {
      if (agentTurnTimer) {
        clearTimeout(agentTurnTimer);
        agentTurnTimer = null;
      }
    }
  
    /* ── Transcript handlers ───────────────────────────────────────── */
  
    // Agent: merge chunks into one bubble until either the user speaks
    // OR no new chunks arrive for AGENT_TURN_TIMEOUT ms.
    function handleAgentTranscript(msg) {
      var text = (msg.transcript || '').trim();
      if (!text) return;
  
      console.log('[VA] agent chunk:', JSON.stringify(text), '| turn:', msg.turn, '| currentRole:', currentRole);
  
      if (currentRole === 'agent' && currentBubble) {
        appendToBubble(text);
      } else {
        // Either no bubble open, or last bubble was user → start fresh
        openBubble('agent', text);
      }
  
      // (Re)start the debounce — turn stays "open" while chunks keep arriving
      startAgentTimer();
    }
  
    // User: interim updates the live user bubble in place; is_final closes it.
    // The user speaking ALSO immediately closes any open agent bubble.
    function handleUserTranscript(msg) {
      var text = (msg.transcript || '').trim();
      if (!text) return;
  
      // User speaking means the agent's turn is definitively over.
      // Cancel the agent timer and close the agent bubble before opening user.
      if (currentRole === 'agent') {
        cancelAgentTimer();
        closeBubble();
      }
  
      if (currentRole === 'user' && currentBubble) {
        // Same user turn — replace (cumulative interim text)
        replaceBubbleText(text);
      } else {
        openBubble('user', text);
      }
  
      if (msg.is_final) {
        console.log('[VA] User turn final:', JSON.stringify(text));
        closeBubble();
      }
    }
  
    /* ── Call / hang button toggle ─────────────────────────────────── */
    function showHangButton() {
      if (vaHangBtn) vaHangBtn.style.display = 'flex';
      vaTakeBtn.style.display = 'none';
    }
    function showTakeButton() {
      if (vaHangBtn) vaHangBtn.style.display = 'none';
      vaTakeBtn.style.display = 'flex';
    }
  
    /* ── GnaniWebVoice instance ────────────────────────────────────── */
    var voice = new GnaniWebVoice({
      websocketUrl       : VA_WS_URL,
      onOpen             : function () {
        console.log('[VA] Connected');
        showHangButton();
        startConversation();
      },
      onClose            : function (source) {
        console.log('[VA] Closed —', source);
        showTakeButton();
        endConversation();
      },
      onError            : function (err)    { console.error('[VA] Error:', err); },
      onTOT              : function ()       { console.log('[VA] TOT — bot responding'); },
      onEOT              : function ()       {
        console.log('[VA] EOT — bot done speaking this segment');
        // DON'T close the bubble — the debounce timer + user_transcript
        // are the only signals that should close it.
      },
      onUserTranscript   : handleUserTranscript,
      onAgentTranscript  : handleAgentTranscript,
    });
  
    vaTakeBtn.addEventListener('click', function () { voice.connect(); });
    if (vaHangBtn) vaHangBtn.addEventListener('click', function () { voice.disconnect(); });
  
    console.log('[VA] Ready ✓ — placeholders hidden, debounce =', AGENT_TURN_TIMEOUT, 'ms');
  });
document.addEventListener('DOMContentLoaded', function () {
    'use strict';
  
    /* ── CONFIG ──────────────────────────────────────────────────────── */
    const STT_ENDPOINT = 'https://vachana-appdevbk.gnani.site/platform/services/asr';
    const MAX_DURATION = 30_000;
  
    const LANG_MAP = {
      English : 'en-IN',
      Tamil   : 'ta-IN',
      Hindi   : 'hi-IN',
    };
  
    /* ── ELEMENTS ────────────────────────────────────────────────────── */
    const elMic        = document.getElementById('st-speak-now');
    const elWave       = document.getElementById('st-listen');
    const elReset      = document.getElementById('st-start-again');
    const elTextarea   = document.getElementById('field');
    const elLangSelect = document.getElementById('St-Language');
  
    // Guard: if any element is missing, log and bail cleanly
    const missing = ['st-speak-now','st-listen','st-start-again','field','St-Language']
      .filter(id => !document.getElementById(id));
    if (missing.length) {
      console.error('[STT] Aborting — elements not found:', missing);
      return;
    }
    console.log('[STT] DOM ready — all elements found ✓');
  
    /* ── SHOW / HIDE ─────────────────────────────────────────────────── */
    // CSS hides these by default; must set explicit inline styles to show them
    const show = el => { el.style.opacity = '1'; el.style.display = 'flex'; };
    const hide = el => { el.style.opacity = '0'; el.style.display = 'none'; };
  
    /* ── STATE MACHINE ───────────────────────────────────────────────── */
    function setState(state) {
      console.log('[STT] state →', state);
      switch (state) {
        case 'idle':
          show(elMic);
          show(elWave);
          elTextarea.value       = '';
          elTextarea.placeholder = 'Example Text';
          elTextarea.disabled    = false;
          break;
        case 'recording':
          hide(elMic);
          show(elWave);
          elTextarea.value       = '';
          elTextarea.placeholder = 'Listening…';
          elTextarea.disabled    = true;
          break;
        case 'processing':
          hide(elMic);
          hide(elWave);
          elTextarea.placeholder = 'Transcribing…';
          elTextarea.disabled    = true;
          break;
        case 'result':
          hide(elMic);
          hide(elWave);
          elTextarea.disabled = false;
          break;
        case 'error':
          show(elMic);
          show(elWave);
          elTextarea.disabled = false;
          break;
      }
    }
  
    /* ── RECORDING ───────────────────────────────────────────────────── */
    let mediaRecorder = null;
    let audioChunks   = [];
    let autoStopTimer = null;
  
    async function startRecording() {
      console.log('[STT] startRecording');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error('[STT] Mic access denied:', err);
        alert('Microphone permission is required. Allow access and try again.');
        return;
      }
  
      audioChunks = [];
  
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        '',
      ].find(m => !m || MediaRecorder.isTypeSupported(m));
  
      console.log('[STT] mimeType:', mimeType || 'browser default');
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  
      mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };
  
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        console.log('[STT] Stopped — chunks:', audioChunks.length);
        const rawBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        console.log('[STT] Raw blob:', rawBlob.size, 'bytes |', rawBlob.type);
        processAndSend(rawBlob);
      };
  
      mediaRecorder.start(250);
      setState('recording');
      autoStopTimer = setTimeout(() => {
        console.log('[STT] 30 s limit — auto stopping');
        stopRecording();
      }, MAX_DURATION);
    }
  
    function stopRecording() {
      console.log('[STT] stopRecording');
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }
  
    /* ── WEBM → WAV ──────────────────────────────────────────────────── */
    async function processAndSend(rawBlob) {
      setState('processing');
      let wavBlob;
      try {
        wavBlob = await toWav(rawBlob);
        console.log('[STT] WAV blob:', wavBlob.size, 'bytes');
      } catch (err) {
        console.warn('[STT] WAV conversion failed — sending raw:', err);
        wavBlob = rawBlob;
      }
      await callSTTApi(wavBlob);
    }
  
    async function toWav(blob) {
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx    = window.AudioContext || window.webkitAudioContext;
      const ctx         = new AudioCtx();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      ctx.close();
      return encodeWav(audioBuffer);
    }
  
    function encodeWav(audioBuffer) {
      const sampleRate = audioBuffer.sampleRate;
      const samples    = audioBuffer.getChannelData(0);
      const dataLen    = samples.length * 2;
      const buf        = new ArrayBuffer(44 + dataLen);
      const v          = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  
      str(0,'RIFF');  v.setUint32(4,  36+dataLen,   true);
      str(8,'WAVE');
      str(12,'fmt '); v.setUint32(16, 16,            true);
                      v.setUint16(20, 1,             true);
                      v.setUint16(22, 1,             true);
                      v.setUint32(24, sampleRate,    true);
                      v.setUint32(28, sampleRate*2,  true);
                      v.setUint16(32, 2,             true);
                      v.setUint16(34, 16,            true);
      str(36,'data'); v.setUint32(40, dataLen,       true);
  
      let offset = 44;
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
      return new Blob([buf], { type: 'audio/wav' });
    }
  
    /* ── API CALL ────────────────────────────────────────────────────── */
    async function callSTTApi(wavBlob) {
      const langCode = LANG_MAP[elLangSelect.value] ?? 'en-IN';
      console.log('[STT] POST', STT_ENDPOINT, '| lang:', langCode, '| size:', wavBlob.size);
  
      const form = new FormData();
      form.append('language_code', langCode);
      form.append('audio_file', wavBlob, 'recording.wav');
  
      try {
        const res = await fetch(STT_ENDPOINT, { method: 'POST', body: form });
        console.log('[STT] Response status:', res.status);
  
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }
  
        const data = await res.json();
        console.log('[STT] Response:', data);
  
        if (!data.success) throw new Error(data.message ?? 'success: false');
  
        elTextarea.value = data.transcript || data.output?.literal || '(empty)';
        setState('result');
  
      } catch (err) {
        console.error('[STT] API error:', err);
        elTextarea.value       = '';
        elTextarea.placeholder = `Error: ${err.message}`;
        setState('error');
      }
    }
  
    /* ── RESET ───────────────────────────────────────────────────────── */
    function reset() {
      console.log('[STT] reset');
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
      }
      if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
      audioChunks = []; mediaRecorder = null;
      setState('idle');
    }
  
    /* ── BIND ────────────────────────────────────────────────────────── */
    elMic  .addEventListener('click', startRecording);
    elWave .addEventListener('click', stopRecording);
    elReset.addEventListener('click', reset);
  
    setState('idle');
    console.log('[STT] Ready ✓');
  });
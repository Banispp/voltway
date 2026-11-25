/**
 * VoltWay 2W - Zero-Cost Turn-by-Turn Voice & EV Audio Cue Engine
 * Priority 1: Native Android TextToSpeech (offline capable, AudioFocus ducking, Bluetooth A2DP/SCO)
 * Priority 2: Web Speech API (browser fallback with Indian/Natural English voice selection)
 * Priority 3: Soft Web Audio API harmonic navigation chimes
 */

const VoiceEngine = (function () {
  let enabled = true;
  try {
    const saved = localStorage.getItem('voltway_sound_enabled');
    if (saved !== null) enabled = (saved === 'true');
  } catch (e) {}

  let audioCtx = null;
  let voices = [];
  let lastSpokenText = '';
  let lastSpokenTime = 0;

  function loadVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        voices = window.speechSynthesis.getVoices() || [];
      } catch (e) {}
    }
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function unlockAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtx) audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
      }
      if ('speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      loadVoices();
    } catch (e) {}
  }

  function playChime(type = 'turn') {
    if (!enabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

      const now = audioCtx.currentTime;
      const playTone = (freq, startOffset, dur, peakGain = 0.08, wave = 'sine') => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.0001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + dur + 0.02);
      };

      if (type === 'turn') {
        playTone(659.25, 0, 0.09, 0.07); // E5
        playTone(880.00, 0.09, 0.13, 0.07); // A5
      } else if (type === 'reroute') {
        playTone(587.33, 0, 0.08, 0.06, 'triangle'); // D5
        playTone(440.00, 0.09, 0.11, 0.06, 'triangle'); // A4
      } else if (type === 'arrival') {
        playTone(523.25, 0, 0.12, 0.08); // C5
        playTone(659.25, 0.11, 0.12, 0.08); // E5
        playTone(783.99, 0.22, 0.22, 0.09); // G5
      } else if (type === 'charger') {
        playTone(587.33, 0, 0.10, 0.07); // D5
        playTone(783.99, 0.10, 0.15, 0.08); // G5
      }
    } catch (e) {}
  }

  /**
   * Normalizes street names & metric units for natural human road pronunciation.
   */
  function normalizeSpeechText(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/\bNH\s*(\d+)/gi, 'National Highway $1')
      .replace(/\bSH\s*(\d+)/gi, 'State Highway $1')
      .replace(/\bRd\b\.?/gi, 'Road')
      .replace(/\bSt\b\.?/gi, 'Street')
      .replace(/\bHwy\b\.?/gi, 'Highway')
      .replace(/\bJct\b\.?/gi, 'Junction')
      .replace(/\bopp\b\.?/gi, 'opposite')
      .replace(/\b(\d+)\s*m\b/g, '$1 meters')
      .replace(/\b([\d.]+)\s*km\b/g, '$1 kilometers')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pickNaturalVoice() {
    if (!voices || voices.length === 0) loadVoices();
    const priorities = [
      v => /en[-_]IN/i.test(v.lang) && /google|natural|heera|ravi/i.test(v.name),
      v => /en[-_]IN/i.test(v.lang),
      v => /en[-_]GB/i.test(v.lang) && /google|natural/i.test(v.name),
      v => /en[-_]US/i.test(v.lang) && /google|natural|samantha/i.test(v.name),
      v => /^en/i.test(v.lang)
    ];
    for (const pred of priorities) {
      const match = voices.find(pred);
      if (match) return match;
    }
    return voices[0] || null;
  }

  function stop() {
    try {
      if (window.AndroidTTS && typeof window.AndroidTTS.stop === 'function') {
        window.AndroidTTS.stop();
      }
    } catch (e) {}
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch (e) {}
  }

  function speak(rawText, options = {}) {
    if (!enabled || !rawText) return false;
    const text = normalizeSpeechText(rawText);
    if (!text) return false;

    const now = Date.now();
    const minCooldown = options.cooldownMs != null ? options.cooldownMs : 4500;
    if (!options.force && text === lastSpokenText && (now - lastSpokenTime) < minCooldown) {
      return false;
    }

    lastSpokenText = text;
    lastSpokenTime = now;

    if (options.chime) {
      playChime(options.chime);
    }

    // 1. Native Android TTS bridge (offline capable + AudioFocus ducking + Bluetooth headset routing)
    try {
      if (window.AndroidTTS && typeof window.AndroidTTS.speak === 'function') {
        const isReady = typeof window.AndroidTTS.isReady === 'function' ? window.AndroidTTS.isReady() : true;
        if (isReady) {
          window.AndroidTTS.speak(text, options.flush !== false);
          return true;
        }
      }
    } catch (e) {}

    // 2. Web Speech API fallback (desktop & mobile PWA)
    try {
      if ('speechSynthesis' in window) {
        if (options.flush !== false) {
          window.speechSynthesis.cancel();
        }
        const utter = new SpeechSynthesisUtterance(text);
        const voice = pickNaturalVoice();
        if (voice) utter.voice = voice;
        utter.lang = (voice && voice.lang) || 'en-IN';
        utter.rate = 0.98;
        utter.pitch = 1.0;
        utter.volume = 1.0;
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utter);
        return true;
      }
    } catch (e) {}

    return false;
  }

  function setEnabled(val) {
    enabled = Boolean(val);
    try {
      localStorage.setItem('voltway_sound_enabled', String(enabled));
    } catch (e) {}
    if (!enabled) {
      stop();
    } else {
      unlockAudio();
    }
    return enabled;
  }

  function toggle() {
    const next = setEnabled(!enabled);
    if (next) {
      speak('Voice guidance active', { force: true, chime: 'turn' });
    }
    return next;
  }

  function resetDedup() {
    lastSpokenText = '';
    lastSpokenTime = 0;
  }

  return {
    speak,
    stop,
    playChime,
    unlockAudio,
    toggle,
    setEnabled,
    resetDedup,
    isEnabled: () => enabled
  };
})();

window.VoiceEngine = VoiceEngine;

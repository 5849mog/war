const FREQUENCIES = Object.freeze({
  tap: 520,
  deployed: 350,
  shot: 260,
  breach: 180,
  settled: 660,
});

let context = null;

export function playCue(kind, enabled = true) {
  if (!enabled) return false;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return false;
  try {
    context ||= new AudioContextClass();
    if (context.state === 'suspended') context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = kind === 'breach' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(FREQUENCIES[kind] || FREQUENCIES.tap, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, (FREQUENCIES[kind] || FREQUENCIES.tap) * 0.72), start + 0.09);
    gain.gain.setValueAtTime(0.035, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.12);
    return true;
  } catch {
    return false;
  }
}

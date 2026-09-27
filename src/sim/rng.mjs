export function nextRandom(state) {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return { value: value / 0x100000000, state: value || 0x6d2b79f5 };
}

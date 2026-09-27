import { BALANCE } from '../config/balance.mjs';
import { nextRandom } from './rng.mjs';

// M0 proves that simulation advances in fixed, replayable steps. Combat is added in M2.
export function createSimulation(seed = 1) {
  return Object.freeze({ tick: 0, tickMs: BALANCE.tickMs, rngState: (seed >>> 0) || 0x6d2b79f5, markers: 0, events: [] });
}

export function stepSimulation(state, commands = []) {
  const rng = nextRandom(state.rngState);
  const events = [...state.events];
  let markers = state.markers;
  for (const command of commands) {
    if (command.type === 'marker') {
      markers += 1;
      events.push({ tick: state.tick + 1, type: 'marker', value: rng.value, x: command.x, y: command.y });
    }
  }
  return Object.freeze({
    tick: state.tick + 1,
    tickMs: state.tickMs,
    rngState: rng.state,
    markers,
    events,
  });
}

export function replaySimulation(seed, commandsByTick, ticks) {
  let state = createSimulation(seed);
  for (let tick = 0; tick < ticks; tick += 1) state = stepSimulation(state, commandsByTick[tick] || []);
  return state;
}

export function simulationDigest(state) {
  return JSON.stringify({ tick: state.tick, rngState: state.rngState, markers: state.markers, events: state.events });
}

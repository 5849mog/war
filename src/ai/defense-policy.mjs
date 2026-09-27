// M2 baseline policy: react at the first deployment and hold each unit at its saved post.
// M4 replaces this conservative policy with deterministic hold/exit-path evaluation.
export function activateDefense(state) {
  const decisions = [...state.defenders]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((unit) => ({
      tick: state.tick,
      unitId: unit.id,
      decision: 'hold',
      reason: unit.type === 'crossbow' ? 'M2 baseline: retain firing post' : 'M2 baseline: retain guard post',
    }));
  state.aiDecisions.push(...decisions);
  for (const decision of decisions) state.events.push({ ...decision, type: 'ai-decision' });
  return decisions;
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INITIAL_INPUT,
  clampToFence,
  createMission,
  headingDegrees,
  horizontalDistance,
  insideFence,
  snapshot,
  step,
  type SimInput,
  type SimState,
} from './engine.ts';

function integrate(state: SimState, seconds: number, input: SimInput): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) step(state, dt, input);
}

describe('geofence', () => {
  it('accepts the center and rejects points outside the cylinder', () => {
    const fence = createMission().fence;
    assert.equal(insideFence({ x: 0, y: 8, z: 0 }, fence), true);
    assert.equal(insideFence({ x: fence.radius + 0.2, y: 1, z: 0 }, fence), false);
    assert.equal(insideFence({ x: 0, y: fence.ceiling + 1, z: 0 }, fence), false);
  });

  it('pulls an outside point back inside the margin', () => {
    const fence = createMission().fence;
    const clamped = clampToFence({ x: 40, y: 30, z: 0 }, fence, 0.8);
    assert.ok(horizontalDistance(clamped, { x: 0, y: 0, z: 0 }) <= fence.radius - 0.8 + 1e-6);
    assert.equal(clamped.y, fence.ceiling);
    const inside = clampToFence({ x: 2, y: 4, z: -2 }, fence, 0.8);
    assert.deepEqual(inside, { x: 2, y: 4, z: -2 });
  });
});

describe('mission step', () => {
  it('keeps the patrol inside the armed geofence', () => {
    const state = createMission();
    integrate(state, 40, INITIAL_INPUT);
    assert.equal(state.droneInside, true);
    assert.ok(horizontalDistance(state.drone.position, { x: 0, y: 0, z: 0 }) <= state.fence.radius);
    assert.ok(horizontalDistance(state.drone.position, { x: 0, y: 0, z: 0 }) > 3);
  });

  it('lets Bravo leave the yard while Alfa stays inside', () => {
    const state = createMission();
    integrate(state, 6, INITIAL_INPUT);
    assert.ok(state.outsideTargetIds.includes('bravo'));
    assert.equal(state.outsideTargetIds.includes('alfa'), false);
    const alfa = state.targets.find((target) => target.id === 'alfa');
    assert.ok(alfa);
    assert.equal(insideFence(alfa.position, state.fence), true);
  });

  it('closes range on a target inside the yard', () => {
    const state = createMission();
    state.drone.position = { x: -18, y: 8, z: -18 };
    const before = snapshot(state).targets.find((target) => target.id === 'alfa')?.range ?? 0;
    integrate(state, 8, { ...INITIAL_INPUT, mode: 'track', trackId: 'alfa' });
    assert.equal(state.trackId, 'alfa');
    assert.ok((state.trackRange ?? before) < before - 8);
    assert.equal(state.droneInside, true);
  });

  it('holds the drone on the fence while the target is outside', () => {
    const state = createMission();
    integrate(state, 8, {
      ...INITIAL_INPUT,
      mode: 'track',
      trackId: 'bravo',
      fenceRadius: 10,
    });
    assert.equal(state.trackId, 'bravo');
    assert.ok(horizontalDistance(state.drone.position, { x: 0, y: 0, z: 0 }) <= 10.05);
    assert.equal(state.droneInside, true);
    assert.equal(state.holdingAtFence, true);
  });

  it('allows the drone to leave when the geofence is disarmed', () => {
    const state = createMission();
    integrate(state, 8, {
      ...INITIAL_INPUT,
      mode: 'track',
      trackId: 'bravo',
      fenceRadius: 10,
      fenceArmed: false,
    });
    assert.equal(state.droneInside, false);
  });

  it('returns home', () => {
    const state = createMission();
    state.drone.position = { x: 18, y: 8, z: -12 };
    integrate(state, 12, { ...INITIAL_INPUT, mode: 'rtl' });
    assert.ok(Math.hypot(state.drone.position.x, state.drone.position.y - 0.35, state.drone.position.z) < 1.5);
  });

  it('freezes motion while paused', () => {
    const state = createMission();
    const position = { ...state.drone.position };
    integrate(state, 3, { ...INITIAL_INPUT, paused: true });
    assert.equal(state.time, 0);
    assert.deepEqual(state.drone.position, position);
  });
});

describe('heading', () => {
  it('maps yaw 0 to north and a quarter turn to east', () => {
    assert.equal(headingDegrees(0), 0);
    assert.ok(Math.abs(headingDegrees(Math.PI / 2) - 90) < 1e-9);
  });
});

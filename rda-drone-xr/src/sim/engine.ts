export type Vec3 = { x: number; y: number; z: number };

export type DroneMode = 'idle' | 'patrol' | 'track' | 'rtl';

export type TargetKind = 'vehicle' | 'person';

export type Target = {
  id: string;
  callsign: string;
  kind: TargetKind;
  position: Vec3;
  yaw: number;
  speed: number;
  path: Vec3[];
  segment: number;
  pathCursor: number;
};

export type Drone = {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  battery: number;
  waypoint: number;
};

export type Geofence = {
  cx: number;
  cz: number;
  radius: number;
  floor: number;
  ceiling: number;
};

export type SimState = {
  time: number;
  drone: Drone;
  targets: Target[];
  fence: Geofence;
  mode: DroneMode;
  trackId: string | null;
  fenceArmed: boolean;
  droneInside: boolean;
  holdingAtFence: boolean;
  outsideTargetIds: string[];
  trackRange: number | null;
};

export type SimInput = {
  mode: DroneMode;
  trackId: string | null;
  paused: boolean;
  fenceRadius: number;
  fenceArmed: boolean;
};

export type TargetSnapshot = {
  id: string;
  callsign: string;
  kind: TargetKind;
  east: number;
  north: number;
  outside: boolean;
  range: number;
};

export type Telemetry = {
  time: number;
  mode: DroneMode;
  altitude: number;
  speed: number;
  headingDeg: number;
  battery: number;
  east: number;
  north: number;
  fenceRadius: number;
  fenceArmed: boolean;
  droneInside: boolean;
  holdingAtFence: boolean;
  waypoint: number;
  waypointCount: number;
  trackId: string | null;
  trackCallsign: string | null;
  trackRange: number | null;
  targets: TargetSnapshot[];
};

export const HOME: Vec3 = { x: 0, y: 0.35, z: 0 };
export const CRUISE_ALTITUDE = 8;
export const MAX_SPEED = 6.5;
export const TRACK_STANDOFF = 5;
const MAX_ACCEL = 14;
const FENCE_MARGIN = 0.8;

export const PATROL_WAYPOINTS: Vec3[] = [
  { x: 14, y: CRUISE_ALTITUDE, z: 10 },
  { x: 12, y: CRUISE_ALTITUDE, z: -12 },
  { x: -12, y: CRUISE_ALTITUDE, z: -14 },
  { x: -14, y: CRUISE_ALTITUDE, z: 10 },
];

export const INITIAL_INPUT: SimInput = {
  mode: 'patrol',
  trackId: null,
  paused: false,
  fenceRadius: 26,
  fenceArmed: true,
};

const TARGET_PATHS: Array<Omit<Target, 'position' | 'yaw' | 'segment' | 'pathCursor'>> = [
  {
    id: 'alfa',
    callsign: 'Alfa',
    kind: 'vehicle',
    speed: 3.1,
    path: [
      { x: 8, y: 0, z: 6 },
      { x: 14, y: 0, z: -4 },
      { x: 4, y: 0, z: -12 },
      { x: -6, y: 0, z: -6 },
      { x: -8, y: 0, z: 8 },
    ],
  },
  {
    id: 'bravo',
    callsign: 'Bravo',
    kind: 'vehicle',
    speed: 4.6,
    path: [
      { x: 18, y: 0, z: 2 },
      { x: 30, y: 0, z: 8 },
      { x: 32, y: 0, z: -12 },
      { x: 16, y: 0, z: -16 },
      { x: 6, y: 0, z: -4 },
    ],
  },
  {
    id: 'charlie',
    callsign: 'Charlie',
    kind: 'person',
    speed: 1.25,
    path: [
      { x: -4, y: 0, z: 4 },
      { x: -2, y: 0, z: 10 },
      { x: 3, y: 0, z: 8 },
      { x: 2, y: 0, z: 2 },
    ],
  },
];

export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function headingDegrees(yaw: number): number {
  const degrees = (yaw * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

export function insideFence(point: Vec3, fence: Geofence): boolean {
  const radial = Math.hypot(point.x - fence.cx, point.z - fence.cz);
  return radial <= fence.radius + 1e-6 && point.y >= fence.floor - 1e-6 && point.y <= fence.ceiling + 1e-6;
}

export function clampToFence(point: Vec3, fence: Geofence, margin: number): Vec3 {
  const dx = point.x - fence.cx;
  const dz = point.z - fence.cz;
  const radial = Math.hypot(dx, dz);
  const limit = Math.max(0, fence.radius - margin);
  let x = point.x;
  let z = point.z;
  if (radial > limit && radial > 0) {
    const scale = limit / radial;
    x = fence.cx + dx * scale;
    z = fence.cz + dz * scale;
  }
  return {
    x,
    y: Math.min(fence.ceiling, Math.max(fence.floor, point.y)),
    z,
  };
}

export function createMission(): SimState {
  const targets = TARGET_PATHS.map((spec) => {
    const first = spec.path[0];
    const next = spec.path[1] ?? first;
    return {
      ...spec,
      path: spec.path.map((point) => ({ ...point })),
      position: { x: first.x, y: 0, z: first.z },
      yaw: Math.atan2(next.x - first.x, next.z - first.z),
      segment: 0,
      pathCursor: 0,
    };
  });

  const state: SimState = {
    time: 0,
    drone: {
      position: { ...HOME },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      battery: 0.92,
      waypoint: 0,
    },
    targets,
    fence: {
      cx: 0,
      cz: 0,
      radius: INITIAL_INPUT.fenceRadius,
      floor: 0,
      ceiling: 16,
    },
    mode: INITIAL_INPUT.mode,
    trackId: null,
    fenceArmed: INITIAL_INPUT.fenceArmed,
    droneInside: true,
    holdingAtFence: false,
    outsideTargetIds: [],
    trackRange: null,
  };
  refreshStatus(state);
  return state;
}

export function step(state: SimState, dt: number, input: SimInput): void {
  state.mode = input.mode;
  state.fenceArmed = input.fenceArmed;
  state.fence.radius = Math.max(4, input.fenceRadius);
  if (input.mode === 'track') {
    state.trackId = input.trackId ?? state.trackId;
    resolveTrack(state);
  } else if (input.trackId) {
    state.trackId = input.trackId;
  }

  if (input.paused || dt <= 0) {
    refreshStatus(state);
    return;
  }

  const stepDt = Math.min(dt, 0.05);
  state.holdingAtFence = false;
  for (const target of state.targets) {
    advanceTarget(target, stepDt);
  }

  const maxSpeed = MAX_SPEED * (state.drone.battery > 0.05 ? 1 : 0.25);
  let desired = desiredPosition(state);
  if (state.fenceArmed) {
    const clamped = clampToFence(desired, state.fence, FENCE_MARGIN);
    if (Math.hypot(clamped.x - desired.x, clamped.z - desired.z) > 0.02) {
      state.holdingAtFence = true;
    }
    desired = clamped;
  }

  seek(state.drone, desired, stepDt, maxSpeed);

  if (state.fenceArmed) {
    const clamped = clampToFence(state.drone.position, state.fence, FENCE_MARGIN);
    if (Math.hypot(clamped.x - state.drone.position.x, clamped.z - state.drone.position.z) > 0.01) {
      state.holdingAtFence = true;
      state.drone.position.x = clamped.x;
      state.drone.position.z = clamped.z;
      killOutwardVelocity(state.drone, state.fence);
    }
    state.drone.position.y = clamped.y;
  }

  turnDrone(state, desired, stepDt);
  const speed = Math.hypot(state.drone.velocity.x, state.drone.velocity.y, state.drone.velocity.z);
  state.drone.battery = Math.max(0, state.drone.battery - stepDt * (0.0015 + speed * 0.0004));
  state.time += stepDt;
  refreshStatus(state);
}

export function snapshot(state: SimState): Telemetry {
  const tracked = state.targets.find((target) => target.id === state.trackId) ?? null;
  return {
    time: state.time,
    mode: state.mode,
    altitude: state.drone.position.y,
    speed: Math.hypot(state.drone.velocity.x, state.drone.velocity.z),
    headingDeg: headingDegrees(state.drone.yaw),
    battery: state.drone.battery,
    east: state.drone.position.x,
    north: state.drone.position.z,
    fenceRadius: state.fence.radius,
    fenceArmed: state.fenceArmed,
    droneInside: state.droneInside,
    holdingAtFence: state.holdingAtFence,
    waypoint: state.drone.waypoint,
    waypointCount: PATROL_WAYPOINTS.length,
    trackId: tracked?.id ?? null,
    trackCallsign: tracked?.callsign ?? null,
    trackRange: state.trackRange,
    targets: state.targets.map((target) => ({
      id: target.id,
      callsign: target.callsign,
      kind: target.kind,
      east: target.position.x,
      north: target.position.z,
      outside: state.outsideTargetIds.includes(target.id),
      range: distance3(state.drone.position, target.position),
    })),
  };
}

function desiredPosition(state: SimState): Vec3 {
  if (state.mode === 'rtl') {
    const homeDistance = horizontalDistance(state.drone.position, HOME);
    return homeDistance > 1.2
      ? { x: HOME.x, y: CRUISE_ALTITUDE, z: HOME.z }
      : { ...HOME };
  }

  if (state.mode === 'track') {
    const target = state.targets.find((item) => item.id === state.trackId);
    if (!target) {
      return { ...state.drone.position };
    }
    const dx = target.position.x - state.drone.position.x;
    const dz = target.position.z - state.drone.position.z;
    const radial = Math.hypot(dx, dz);
    if (radial < 0.2) {
      return { x: target.position.x, y: CRUISE_ALTITUDE, z: target.position.z + TRACK_STANDOFF };
    }
    return {
      x: target.position.x - (dx / radial) * TRACK_STANDOFF,
      y: CRUISE_ALTITUDE,
      z: target.position.z - (dz / radial) * TRACK_STANDOFF,
    };
  }

  if (state.mode === 'patrol') {
    const waypoint = PATROL_WAYPOINTS[state.drone.waypoint];
    if (horizontalDistance(state.drone.position, waypoint) < 1.5) {
      state.drone.waypoint = (state.drone.waypoint + 1) % PATROL_WAYPOINTS.length;
    }
    return { ...PATROL_WAYPOINTS[state.drone.waypoint] };
  }

  return { ...state.drone.position, y: Math.max(state.drone.position.y, 1.2) };
}

function seek(drone: Drone, desired: Vec3, dt: number, maxSpeed: number): void {
  const dx = desired.x - drone.position.x;
  const dy = desired.y - drone.position.y;
  const dz = desired.z - drone.position.z;
  const dist = Math.hypot(dx, dy, dz);
  let vx = 0;
  let vy = 0;
  let vz = 0;
  if (dist > 0.08) {
    const speed = Math.min(maxSpeed, 0.55 + dist * 0.85);
    vx = (dx / dist) * speed;
    vy = (dy / dist) * speed;
    vz = (dz / dist) * speed;
  }
  const limit = MAX_ACCEL * dt;
  drone.velocity.x += clampMagnitude(vx - drone.velocity.x, limit);
  drone.velocity.y += clampMagnitude(vy - drone.velocity.y, limit);
  drone.velocity.z += clampMagnitude(vz - drone.velocity.z, limit);
  drone.position.x += drone.velocity.x * dt;
  drone.position.y += drone.velocity.y * dt;
  drone.position.z += drone.velocity.z * dt;
}

function turnDrone(state: SimState, desired: Vec3, dt: number): void {
  const { drone } = state;
  let aimX = 0;
  let aimZ = 0;
  if (state.mode === 'track') {
    const target = state.targets.find((item) => item.id === state.trackId);
    if (target) {
      aimX = target.position.x - drone.position.x;
      aimZ = target.position.z - drone.position.z;
    }
  }
  if (Math.hypot(aimX, aimZ) < 0.2) {
    const speed = Math.hypot(drone.velocity.x, drone.velocity.z);
    if (speed > 0.4) {
      aimX = drone.velocity.x;
      aimZ = drone.velocity.z;
    } else {
      aimX = desired.x - drone.position.x;
      aimZ = desired.z - drone.position.z;
    }
  }
  if (Math.hypot(aimX, aimZ) < 0.05) return;
  const targetYaw = Math.atan2(aimX, aimZ);
  let delta = Math.atan2(Math.sin(targetYaw - drone.yaw), Math.cos(targetYaw - drone.yaw));
  const maxStep = dt * 2.6;
  delta = clampMagnitude(delta, maxStep);
  drone.yaw += delta;
}

function advanceTarget(target: Target, dt: number): void {
  let remaining = target.speed * dt;
  for (let guard = 0; guard < 8 && remaining > 0; guard += 1) {
    const from = target.path[target.segment];
    const to = target.path[(target.segment + 1) % target.path.length];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 1e-4) {
      target.segment = (target.segment + 1) % target.path.length;
      target.pathCursor = 0;
      continue;
    }
    const left = (1 - target.pathCursor) * length;
    if (remaining < left) {
      target.pathCursor += remaining / length;
      remaining = 0;
    } else {
      remaining -= left;
      target.segment = (target.segment + 1) % target.path.length;
      target.pathCursor = 0;
    }
  }
  const from = target.path[target.segment];
  const to = target.path[(target.segment + 1) % target.path.length];
  const cursor = target.pathCursor;
  target.position.x = from.x + (to.x - from.x) * cursor;
  target.position.y = 0;
  target.position.z = from.z + (to.z - from.z) * cursor;
  target.yaw = Math.atan2(to.x - from.x, to.z - from.z);
}

function resolveTrack(state: SimState): Target | null {
  const chosen = state.targets.find((target) => target.id === state.trackId);
  if (chosen) return chosen;
  let best: Target | null = null;
  let bestDistance = Infinity;
  for (const target of state.targets) {
    const dist = horizontalDistance(state.drone.position, target.position);
    if (dist < bestDistance) {
      best = target;
      bestDistance = dist;
    }
  }
  if (best) state.trackId = best.id;
  return best;
}

function refreshStatus(state: SimState): void {
  state.droneInside = insideFence(state.drone.position, state.fence);
  state.outsideTargetIds = state.targets
    .filter((target) => !insideFence(target.position, state.fence))
    .map((target) => target.id);
  const tracked = state.targets.find((target) => target.id === state.trackId) ?? null;
  state.trackRange = tracked ? distance3(state.drone.position, tracked.position) : null;
}

function killOutwardVelocity(drone: Drone, fence: Geofence): void {
  const dx = drone.position.x - fence.cx;
  const dz = drone.position.z - fence.cz;
  const radial = Math.hypot(dx, dz);
  if (radial < 1e-4) return;
  const nx = dx / radial;
  const nz = dz / radial;
  const outward = drone.velocity.x * nx + drone.velocity.z * nz;
  if (outward > 0) {
    drone.velocity.x -= nx * outward;
    drone.velocity.z -= nz * outward;
  }
}

function clampMagnitude(value: number, max: number): number {
  if (value > max) return max;
  if (value < -max) return -max;
  return value;
}

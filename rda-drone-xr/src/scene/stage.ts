import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Controls } from '../control.ts';
import {
  PATROL_WAYPOINTS,
  snapshot,
  step,
  type SimState,
  type Telemetry,
} from '../sim/engine.ts';

export type XrStatus = 'idle' | 'entered' | 'unsupported' | 'denied' | 'ended';

export type Stage = {
  enterXR: () => Promise<XrStatus>;
  dispose: () => void;
};

type StageOptions = {
  host: HTMLElement;
  getSim: () => SimState;
  getInput: () => Controls;
  onFrame: (snap: Telemetry) => void;
  onPick: (id: string) => void;
  onXr: (status: XrStatus) => void;
};

const TARGET_COLORS: Record<string, number> = {
  alfa: 0xf5b942,
  bravo: 0xff5d73,
  charlie: 0x7ec8ff,
};

export function createStage(options: StageOptions): Stage {
  const { host, getSim, getInput, onFrame, onPick, onXr } = options;
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(resource: T): T => {
    disposables.push(resource);
    return resource;
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x121a24, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121a24);
  scene.fog = new THREE.Fog(0x121a24, 78, 190);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.15, 280);
  camera.position.set(28, 20, 28);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 5;
  controls.maxDistance = 90;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xd7e6f4, 0x3a3228, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff6ea, 3.4);
  sun.position.set(28, 36, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  scene.add(sun);

  const ground = new THREE.Mesh(
    track(new THREE.CircleGeometry(90, 80)),
    track(new THREE.MeshStandardMaterial({ color: 0x314252, roughness: 0.94 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const yardMaterial = track(new THREE.MeshStandardMaterial({ color: 0x3d5164, roughness: 0.9 }));
  const yard = new THREE.Mesh(track(new THREE.CircleGeometry(1, 72)), yardMaterial);
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.02;
  yard.receiveShadow = true;
  scene.add(yard);

  const grid = new THREE.GridHelper(80, 40, 0x2a4558, 0x182833);
  grid.position.y = 0.03;
  track(grid.geometry);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.transparent = true;
    material.opacity = 0.55;
    track(material);
  }
  scene.add(grid);

  const roadMaterial = track(new THREE.MeshStandardMaterial({ color: 0x243240, roughness: 0.88 }));
  const roadX = new THREE.Mesh(track(new THREE.PlaneGeometry(78, 5.5)), roadMaterial);
  roadX.rotation.x = -Math.PI / 2;
  roadX.position.y = 0.025;
  roadX.receiveShadow = true;
  scene.add(roadX);
  const roadZ = new THREE.Mesh(track(new THREE.PlaneGeometry(5.5, 78)), roadMaterial);
  roadZ.rotation.x = -Math.PI / 2;
  roadZ.position.y = 0.026;
  roadZ.receiveShadow = true;
  scene.add(roadZ);

  const pad = new THREE.Mesh(
    track(new THREE.RingGeometry(1.55, 2.15, 40)),
    track(new THREE.MeshStandardMaterial({ color: 0xd7fff6, roughness: 0.5, metalness: 0.1 })),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.04;
  scene.add(pad);
  const padHMaterial = track(new THREE.MeshStandardMaterial({ color: 0x07110f, roughness: 0.6 }));
  const padBar = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.02, 0.9)), padHMaterial);
  padBar.position.set(0, 0.05, 0);
  scene.add(padBar);
  const padLeft = padBar.clone();
  padLeft.scale.set(1, 1, 0.22);
  padLeft.position.set(-0.28, 0.05, 0);
  scene.add(padLeft);
  const padRight = padLeft.clone();
  padRight.position.set(0.28, 0.05, 0);
  scene.add(padRight);

  const fenceMaterial = track(
    new THREE.MeshBasicMaterial({
        color: 0x3ee0c5,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const fence = new THREE.Mesh(track(new THREE.CylinderGeometry(1, 1, 16, 72, 1, true)), fenceMaterial);
  fence.position.y = 8;
  scene.add(fence);
  const ringMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0x3ee0c5, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  const ring = new THREE.Mesh(track(new THREE.RingGeometry(0.985, 1.015, 80)), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  scene.add(ring);

  const sweepPivot = new THREE.Group();
  sweepPivot.position.y = 0.05;
  const sweep = new THREE.Mesh(
    track(new THREE.CircleGeometry(1, 40, 0, Math.PI / 7)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x3ee0c5,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  sweep.rotation.x = -Math.PI / 2;
  sweepPivot.add(sweep);
  scene.add(sweepPivot);

  const routePoints = PATROL_WAYPOINTS.map((point) => new THREE.Vector3(point.x, 0.08, point.z));
  routePoints.push(routePoints[0].clone());
  const route = new THREE.Line(
    track(new THREE.BufferGeometry().setFromPoints(routePoints)),
    track(new THREE.LineDashedMaterial({ color: 0x8ef3e4, dashSize: 0.7, gapSize: 0.45, transparent: true, opacity: 0.45 })),
  );
  route.computeLineDistances();
  scene.add(route);
  const markerMaterial = track(new THREE.MeshStandardMaterial({ color: 0x8ef3e4, emissive: 0x14584e, roughness: 0.4 }));
  for (const point of PATROL_WAYPOINTS) {
    const marker = new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16)), markerMaterial);
    marker.position.set(point.x, 0.06, point.z);
    scene.add(marker);
  }

  const windows = track(makeWindowTexture());
  const buildings = [
    { x: -22, z: -18, w: 12, d: 8, h: 8 },
    { x: 20, z: 20, w: 16, d: 10, h: 12 },
    { x: -24, z: 16, w: 10, d: 14, h: 6 },
    { x: 26, z: -20, w: 9, d: 11, h: 18 },
    { x: 0, z: -28, w: 22, d: 7, h: 5 },
    { x: 9, z: -7, w: 6, d: 4, h: 3 },
  ];
  for (const building of buildings) {
    scene.add(makeBuilding(building, windows, track));
  }

  const poleMaterial = track(new THREE.MeshStandardMaterial({ color: 0x8d98a3, metalness: 0.7, roughness: 0.3 }));
  const lampMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0xfff4d2, emissive: 0xffc56a, emissiveIntensity: 0.8 }),
  );
  for (const [x, z] of [
    [-16, -16],
    [16, -16],
    [16, 16],
    [-16, 16],
  ] as const) {
    const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07, 0.09, 5, 8)), poleMaterial);
    pole.position.set(x, 2.5, z);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new THREE.Mesh(track(new THREE.SphereGeometry(0.16, 12, 8)), lampMaterial);
    lamp.position.set(x, 5.05, z);
    scene.add(lamp);
  }

  const north = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.35, 1.1, 4)),
    track(new THREE.MeshStandardMaterial({ color: 0xf5b942, emissive: 0x6a4a12 })),
  );
  north.position.set(0, 0.4, 20);
  north.rotation.x = Math.PI / 2;
  scene.add(north);

  const drone = makeDrone(track);
  scene.add(drone.group);

  const trailCapacity = 96;
  const trailPositions = new Float32Array(trailCapacity * 3);
  const trailGeometry = track(new THREE.BufferGeometry());
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new THREE.Line(
    trailGeometry,
    track(new THREE.LineBasicMaterial({ color: 0x3ee0c5, transparent: true, opacity: 0.7 })),
  );
  scene.add(trail);
  let trailCount = 0;

  const lockPositions = new Float32Array(6);
  const lockGeometry = track(new THREE.BufferGeometry());
  lockGeometry.setAttribute('position', new THREE.BufferAttribute(lockPositions, 3));
  const lockLine = new THREE.Line(
    lockGeometry,
    track(new THREE.LineDashedMaterial({ color: 0xf5b942, dashSize: 0.45, gapSize: 0.28, transparent: true, opacity: 0.9 })),
  );
  scene.add(lockLine);

  const pickables: THREE.Object3D[] = [];
  const targetViews = new Map<string, { group: THREE.Group; ring: THREE.Mesh }>();
  const initial = getSim();
  for (const target of initial.targets) {
    const view = makeTarget(target.id, target.callsign, target.kind, track);
    view.group.position.set(target.position.x, 0, target.position.z);
    view.group.rotation.y = target.yaw;
    scene.add(view.group);
    pickables.push(view.group);
    targetViews.set(target.id, view);
  }

  const stalkGeometry = track(new THREE.BufferGeometry());
  const stalkPositions = new Float32Array(6);
  stalkGeometry.setAttribute('position', new THREE.BufferAttribute(stalkPositions, 3));
  const stalk = new THREE.Line(
    stalkGeometry,
    track(new THREE.LineBasicMaterial({ color: 0x9ff7ea, transparent: true, opacity: 0.45 })),
  );
  scene.add(stalk);

  const lookAt = new THREE.Vector3();
  const chase = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let pointerX = 0;
  let pointerY = 0;
  let publishAt = 0;

  const onPointerDown = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - pointerX, event.clientY - pointerY) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (typeof object.userData.targetId === 'string') {
          onPick(object.userData.targetId);
          return;
        }
        object = object.parent;
      }
    }
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  const timer = new THREE.Timer();
  timer.connect(document);
  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const sim = getSim();
    const input = getInput();
    step(sim, dt, input);
    syncWorld(sim, dt);
    if (!renderer.xr.isPresenting) {
      if (input.camera === 'seguir') {
        const yaw = sim.drone.yaw;
        chase.set(
          sim.drone.position.x - Math.sin(yaw) * 16,
          sim.drone.position.y + 7,
          sim.drone.position.z - Math.cos(yaw) * 16,
        );
        camera.position.lerp(chase, 1 - Math.exp(-3.2 * Math.max(dt, 0.016)));
        lookAt.set(sim.drone.position.x, sim.drone.position.y + 0.3, sim.drone.position.z);
        controls.target.lerp(lookAt, 1 - Math.exp(-4 * Math.max(dt, 0.016)));
      }
      controls.enabled = input.camera === 'maquete';
      controls.update();
    }
    renderer.render(scene, camera);
    publishAt += dt;
    if (publishAt >= 0.1) {
      publishAt = 0;
      onFrame(snapshot(sim));
    }
  });

  function syncWorld(sim: SimState, dt: number): void {
    const radius = sim.fence.radius;
    fence.scale.set(radius, 1, radius);
    ring.scale.set(radius, radius, radius);
    yard.scale.set(radius, radius, radius);
    sweepPivot.scale.setScalar(radius);
    sweepPivot.rotation.y = -sim.time * 0.65;

    const breach = !sim.droneInside || sim.outsideTargetIds.length > 0;
    const color = breach ? 0xff5d73 : sim.holdingAtFence ? 0xf5b942 : 0x3ee0c5;
    fenceMaterial.color.setHex(color);
    fenceMaterial.opacity = 0.07 + Math.sin(sim.time * 2.4) * 0.015 + (breach ? 0.06 : 0);
    ringMaterial.color.setHex(color);

    const { drone: body } = sim;
    drone.group.position.set(body.position.x, body.position.y, body.position.z);
    const forward = body.velocity.x * Math.sin(body.yaw) + body.velocity.z * Math.cos(body.yaw);
    const lateral = body.velocity.x * Math.cos(body.yaw) - body.velocity.z * Math.sin(body.yaw);
    drone.group.rotation.order = 'YXZ';
    drone.group.rotation.y = body.yaw;
    drone.group.rotation.x = THREE.MathUtils.clamp(forward * 0.05, -0.35, 0.35);
    drone.group.rotation.z = THREE.MathUtils.clamp(-lateral * 0.07, -0.35, 0.35);
    const spin = dt * (22 + Math.hypot(body.velocity.x, body.velocity.z) * 2);
    drone.rotors.forEach((rotor, index) => {
      rotor.rotation.y += spin * (index % 2 === 0 ? 1 : -1);
    });

    stalkPositions[0] = body.position.x;
    stalkPositions[1] = body.position.y;
    stalkPositions[2] = body.position.z;
    stalkPositions[3] = body.position.x;
    stalkPositions[4] = 0.05;
    stalkPositions[5] = body.position.z;
    stalkGeometry.attributes.position.needsUpdate = true;

    if (trailCount < trailCapacity) {
      const offset = trailCount * 3;
      trailPositions[offset] = body.position.x;
      trailPositions[offset + 1] = body.position.y;
      trailPositions[offset + 2] = body.position.z;
      trailCount += 1;
    } else {
      trailPositions.copyWithin(0, 3);
      const offset = (trailCapacity - 1) * 3;
      trailPositions[offset] = body.position.x;
      trailPositions[offset + 1] = body.position.y;
      trailPositions[offset + 2] = body.position.z;
    }
    trailGeometry.setDrawRange(0, trailCount);
    trailGeometry.attributes.position.needsUpdate = true;

    const tracking = sim.mode === 'track' ? sim.targets.find((target) => target.id === sim.trackId) : undefined;
    lockLine.visible = Boolean(tracking);
    if (tracking) {
      lockPositions[0] = body.position.x;
      lockPositions[1] = body.position.y;
      lockPositions[2] = body.position.z;
      lockPositions[3] = tracking.position.x;
      lockPositions[4] = 1.2;
      lockPositions[5] = tracking.position.z;
      lockGeometry.attributes.position.needsUpdate = true;
      lockLine.computeLineDistances();
    }

    for (const target of sim.targets) {
      const view = targetViews.get(target.id);
      if (!view) continue;
      view.group.position.set(target.position.x, 0, target.position.z);
      view.group.rotation.y = target.yaw;
      const selected = sim.mode === 'track' && sim.trackId === target.id;
      const outside = sim.outsideTargetIds.includes(target.id);
      view.ring.visible = selected || outside;
      const marker = view.ring.material as THREE.MeshBasicMaterial;
      marker.color.setHex(outside ? 0xff5d73 : 0xf5b942);
    }
  }

  return {
    async enterXR() {
      if (renderer.xr.isPresenting) return 'entered';
      const xr = navigator.xr;
      if (!xr) {
        onXr('unsupported');
        return 'unsupported';
      }
      try {
        const supported = await xr.isSessionSupported('immersive-vr');
        if (!supported) {
          onXr('unsupported');
          return 'unsupported';
        }
        const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
        session.addEventListener('end', () => onXr('ended'));
        await renderer.xr.setSession(session);
        onXr('entered');
        return 'entered';
      } catch {
        onXr('denied');
        return 'denied';
      }
    },
    dispose() {
      renderer.setAnimationLoop(null);
      timer.dispose();
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      for (const resource of disposables) resource.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function makeDrone(track: <T extends { dispose: () => void }>(resource: T) => T): {
  group: THREE.Group;
  rotors: THREE.Group[];
} {
  const group = new THREE.Group();
  const shell = track(
    new THREE.MeshStandardMaterial({ color: 0x4d5c5e, metalness: 0.45, roughness: 0.38 }),
  );
  const body = new THREE.Mesh(track(new THREE.BoxGeometry(0.62, 0.16, 0.32)), shell);
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.09, 0.24, 6)),
    track(new THREE.MeshStandardMaterial({ color: 0x3ee0c5, emissive: 0x14685a, emissiveIntensity: 0.7 })),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.26;
  group.add(nose);
  const armGeo = track(new THREE.BoxGeometry(1.35, 0.035, 0.055));
  const armA = new THREE.Mesh(armGeo, shell);
  const armB = new THREE.Mesh(armGeo, shell);
  armB.rotation.y = Math.PI / 2;
  group.add(armA, armB);

  const rotors: THREE.Group[] = [];
  const discGeo = track(new THREE.CylinderGeometry(0.24, 0.24, 0.012, 18));
  const discMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xbffff4,
      emissive: 0x1a6b5e,
      transparent: true,
      opacity: 0.55,
      roughness: 0.3,
    }),
  );
  for (const [x, z] of [
    [0.52, 0.52],
    [0.52, -0.52],
    [-0.52, 0.52],
    [-0.52, -0.52],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.09, z);
    pivot.add(new THREE.Mesh(discGeo, discMat));
    const hub = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10)),
      shell,
    );
    pivot.add(hub);
    group.add(pivot);
    rotors.push(pivot);
  }

  const port = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.045, 10, 8)),
    track(new THREE.MeshStandardMaterial({ color: 0x39f08a, emissive: 0x1d8a48, emissiveIntensity: 1 })),
  );
  port.position.set(-0.28, 0.04, 0.05);
  const starboard = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.045, 10, 8)),
    track(new THREE.MeshStandardMaterial({ color: 0xff5d73, emissive: 0x8a2434, emissiveIntensity: 1 })),
  );
  starboard.position.set(0.28, 0.04, 0.05);
  group.add(port, starboard);
  group.scale.setScalar(1.45);

  const spot = new THREE.SpotLight(0xd9fff4, 18, 22, 0.55, 0.45, 1);
  spot.position.set(0, 0.05, 0.15);
  spot.target.position.set(0, -6, 2);
  group.add(spot);
  group.add(spot.target);
  return { group, rotors };
}

function makeTarget(
  id: string,
  callsign: string,
  kind: 'vehicle' | 'person',
  track: <T extends { dispose: () => void }>(resource: T) => T,
): { group: THREE.Group; ring: THREE.Mesh } {
  const group = new THREE.Group();
  group.userData.targetId = id;
  const color = TARGET_COLORS[id] ?? 0xffffff;
  const paint = track(new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 }));
  if (kind === 'vehicle') {
    const chassis = new THREE.Mesh(track(new THREE.BoxGeometry(1.15, 0.62, 2.3)), paint);
    chassis.position.y = 0.55;
    chassis.castShadow = true;
    chassis.userData.targetId = id;
    const cabin = new THREE.Mesh(
      track(new THREE.BoxGeometry(1.02, 0.48, 0.9)),
      track(new THREE.MeshStandardMaterial({ color: 0xd5e4ee, roughness: 0.25, metalness: 0.1 })),
    );
    cabin.position.set(0, 1.02, 0.45);
    cabin.userData.targetId = id;
    group.add(chassis, cabin);
  } else {
    const torso = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8)), paint);
    torso.position.y = 1.05;
    torso.castShadow = true;
    torso.userData.targetId = id;
    const head = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.18, 12, 10)),
      track(new THREE.MeshStandardMaterial({ color: 0xf0d2bd, roughness: 0.6 })),
    );
    head.position.y = 1.62;
    head.userData.targetId = id;
    group.add(torso, head);
  }

  const ring = new THREE.Mesh(
    track(new THREE.RingGeometry(0.85, 1.02, 28)),
    track(new THREE.MeshBasicMaterial({ color: 0xf5b942, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.visible = false;
  group.add(ring);
  group.add(makeLabel(callsign, color, track));
  return { group, ring };
}

function makeLabel(
  text: string,
  color: number,
  track: <T extends { dispose: () => void }>(resource: T) => T,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.Sprite();
  }
  context.fillStyle = 'rgba(7, 11, 18, 0.78)';
  context.fillRect(0, 0, 256, 64);
  context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.lineWidth = 4;
  context.strokeRect(3, 3, 250, 58);
  context.fillStyle = '#f4f7fb';
  context.font = '600 28px sans-serif';
  context.fillText(text, 18, 42);
  const texture = track(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = track(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const sprite = new THREE.Sprite(material);
  sprite.position.y = 2.15;
  sprite.scale.set(3.4, 0.85, 1);
  return sprite;
}

function makeBuilding(
  spec: { x: number; z: number; w: number; d: number; h: number },
  windows: THREE.CanvasTexture,
  track: <T extends { dispose: () => void }>(resource: T) => T,
): THREE.Group {
  const group = new THREE.Group();
  const map = track(windows.clone());
  map.needsUpdate = true;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(spec.w / 3, spec.h / 3);
  const material = track(
    new THREE.MeshStandardMaterial({
      color: 0x243140,
      map,
      roughness: 0.78,
      metalness: 0.05,
      emissive: 0x1a3148,
      emissiveMap: map,
      emissiveIntensity: 0.45,
    }),
  );
  const block = new THREE.Mesh(track(new THREE.BoxGeometry(spec.w, spec.h, spec.d)), material);
  block.position.set(spec.x, spec.h / 2, spec.z);
  block.castShadow = true;
  block.receiveShadow = true;
  const roof = new THREE.Mesh(
    track(new THREE.BoxGeometry(spec.w + 0.4, 0.28, spec.d + 0.4)),
    track(new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.7 })),
  );
  roof.position.set(spec.x, spec.h + 0.14, spec.z);
  group.add(block, roof);
  return group;
}

function makeWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = '#1a2430';
  context.fillRect(0, 0, 64, 64);
  for (let y = 6; y < 64; y += 14) {
    for (let x = 6; x < 64; x += 12) {
      if ((x + y) % 11 === 0) continue;
      context.fillStyle = (x * y) % 5 === 0 ? '#f2d48a' : '#d5ecff';
      context.globalAlpha = 0.45 + ((x + y) % 5) * 0.08;
      context.fillRect(x, y, 6, 8);
    }
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

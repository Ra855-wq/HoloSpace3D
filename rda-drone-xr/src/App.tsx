import { useCallback, useEffect, useRef, useState } from 'react';
import { INITIAL_CONTROLS, type Controls } from './control.ts';
import { Hud } from './hud/Hud.tsx';
import { snapshot, step, createMission, type SimState } from './sim/engine.ts';
import { DroneViewport, type ViewportHandle } from './scene/DroneViewport.tsx';
import type { XrStatus } from './scene/stage.ts';

export function App() {
  const simRef = useRef<SimState>(createMission());
  const [controls, setControls] = useState<Controls>(INITIAL_CONTROLS);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const [snap, setSnap] = useState(() => snapshot(simRef.current));
  const [xrStatus, setXrStatus] = useState<XrStatus>('idle');
  const [xrBusy, setXrBusy] = useState(false);
  const viewportRef = useRef<ViewportHandle>(null);

  const commit = useCallback((next: Controls) => {
    controlsRef.current = next;
    setControls(next);
    const sim = simRef.current;
    if (!sim) return;
    step(sim, 0, next);
    setSnap(snapshot(sim));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const current = controlsRef.current;
      if (event.code === 'Space') {
        event.preventDefault();
        commit({ ...current, paused: !current.paused });
        return;
      }
      if (event.key === '1') commit({ ...current, mode: 'patrol', paused: false });
      if (event.key === '2') {
        const sim = simRef.current;
        if (!sim) return;
        const nearest = snapshot(sim).targets.slice().sort((a, b) => a.range - b.range)[0];
        commit({ ...current, mode: 'track', trackId: current.trackId ?? nearest?.id ?? null, paused: false });
      }
      if (event.key === '3') commit({ ...current, mode: 'rtl', paused: false });
      if (event.key === 'g' || event.key === 'G') commit({ ...current, fenceArmed: !current.fenceArmed });
      if (event.key === 'c' || event.key === 'C') {
        commit({ ...current, camera: current.camera === 'maquete' ? 'seguir' : 'maquete' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit]);

  return (
    <main className="relative h-full overflow-hidden bg-ink text-slate-100">
      <DroneViewport
        ref={viewportRef}
        simRef={simRef}
        inputRef={controlsRef}
        onFrame={setSnap}
        onPick={(id) => commit({ ...controlsRef.current, mode: 'track', trackId: id, paused: false })}
        onXr={setXrStatus}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_68%,rgba(7,11,18,0.38)_100%)]" />
      <Hud
        snap={snap}
        controls={controls}
        xrStatus={xrStatus}
        xrBusy={xrBusy}
        onChange={commit}
        onEnterXR={() => {
          setXrBusy(true);
          void viewportRef.current?.enterXR().finally(() => setXrBusy(false));
        }}
      />
    </main>
  );
}

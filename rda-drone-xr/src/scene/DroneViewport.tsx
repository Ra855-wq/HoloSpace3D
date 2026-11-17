import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import { INITIAL_CONTROLS, type Controls } from '../control.ts';
import type { SimState, Telemetry } from '../sim/engine.ts';
import { createStage, type Stage, type XrStatus } from './stage.ts';

export type ViewportHandle = {
  enterXR: () => Promise<XrStatus>;
};

type ViewportProps = {
  simRef: RefObject<SimState | null>;
  inputRef: RefObject<Controls | null>;
  onFrame: (snap: Telemetry) => void;
  onPick: (id: string) => void;
  onXr: (status: XrStatus) => void;
};

export const DroneViewport = forwardRef<ViewportHandle, ViewportProps>(function DroneViewport(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    enterXR: () => stageRef.current?.enterXR() ?? Promise.resolve('unsupported'),
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const stage = createStage({
      host,
      getSim: () => {
        const sim = propsRef.current.simRef.current;
        if (!sim) throw new Error('Simulação indisponível');
        return sim;
      },
      getInput: () => propsRef.current.inputRef.current ?? INITIAL_CONTROLS,
      onFrame: (snap) => propsRef.current.onFrame(snap),
      onPick: (id) => propsRef.current.onPick(id),
      onXr: (status) => propsRef.current.onXr(status),
    });
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0" />;
});

import { INITIAL_INPUT, type SimInput } from './sim/engine.ts';

export type CameraMode = 'maquete' | 'seguir';

export type Controls = SimInput & {
  camera: CameraMode;
};

export const INITIAL_CONTROLS: Controls = {
  ...INITIAL_INPUT,
  camera: 'maquete',
};

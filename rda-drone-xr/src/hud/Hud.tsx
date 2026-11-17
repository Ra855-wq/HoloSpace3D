import { Car, Compass, Crosshair, House, Pause, PersonStanding, Play, Radar, Shield, ShieldOff, Video } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Controls } from '../control.ts';
import type { Telemetry } from '../sim/engine.ts';
import type { XrStatus } from '../scene/stage.ts';

type HudProps = {
  snap: Telemetry;
  controls: Controls;
  xrStatus: XrStatus;
  xrBusy: boolean;
  onChange: (next: Controls) => void;
  onEnterXR: () => void;
};

const MODE_LABEL: Record<Telemetry['mode'], string> = {
  idle: 'Pairado',
  patrol: 'Patrulha',
  track: 'Rastreio',
  rtl: 'Retorno',
};

export function Hud({ snap, controls, xrStatus, xrBusy, onChange, onEnterXR }: HudProps) {
  const alert = describeAlert(snap);
  const patch = (partial: Partial<Controls>) => onChange({ ...controls, ...partial });

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <header className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="pointer-events-auto flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center border border-nominal/40 bg-nominal/10 font-display text-xs tracking-wide text-nominal">
            RDA
          </span>
          <div>
            <p className="font-display text-sm tracking-[0.16em] text-white">DRONE XR</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">Pátio Norte · maquete</p>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2 font-mono text-[11px] text-slate-300">
          <span className="hidden sm:inline">{controls.camera === 'maquete' ? 'MAQUETE' : 'SEGUIR'}</span>
          <span className="border border-line bg-panel/80 px-2 py-1 tabular-nums">T+ {clock(snap.time)}</span>
          <span className="inline-flex items-center gap-1 border border-line bg-panel/80 px-2 py-1">
            <span className={`h-1.5 w-1.5 rounded-full ${controls.paused ? 'bg-caution' : 'bg-nominal'}`} />
            {controls.paused ? 'PAUSA' : 'AO VIVO'}
          </span>
        </div>
      </header>

      <div className="absolute top-16 left-1/2 w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2">
        <AnimatePresence mode="wait">
          {alert ? (
            <motion.div
              key={alert.text}
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className={`pointer-events-auto border px-3 py-2 text-center font-mono text-[11px] tracking-wide uppercase ${
                alert.tone === 'breach'
                  ? 'border-breach/50 bg-breach/15 text-breach'
                  : 'border-caution/50 bg-caution/15 text-caution'
              }`}
            >
              {alert.text}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <aside className="absolute top-16 bottom-28 left-3 hidden w-48 flex-col gap-2 md:flex">
        <ModeStack controls={controls} snap={snap} onChange={onChange} />
        <FenceCard controls={controls} onChange={onChange} />
        <ViewCard controls={controls} xrStatus={xrStatus} xrBusy={xrBusy} onChange={onChange} onEnterXR={onEnterXR} />
      </aside>

      <aside className="absolute top-16 right-3 bottom-28 hidden w-64 flex-col gap-2 overflow-auto lg:flex">
        <section className="border border-line/80 bg-panel/80 p-3 backdrop-blur-md">
          <p className="font-mono text-[10px] tracking-[0.18em] text-slate-400">TELEMETRIA</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[12px] tabular-nums">
            <Row label="Modo" value={controls.paused ? 'Pausa' : MODE_LABEL[snap.mode]} />
            <Row label="Altitude" value={`${snap.altitude.toFixed(1)} m`} />
            <Row label="Velocidade" value={`${snap.speed.toFixed(1)} m/s`} />
            <Row label="Proa" value={`${Math.round(snap.headingDeg).toString().padStart(3, '0')}°`} />
            <Row label="Leste" value={signed(snap.east)} />
            <Row label="Norte" value={signed(snap.north)} />
            <Row label="Perímetro" value={snap.droneInside ? 'Contido' : 'Fora'} warn={!snap.droneInside} />
            <Row
              label="Alvo"
              value={snap.trackCallsign ? `${snap.trackCallsign} ${snap.trackRange?.toFixed(0) ?? '—'} m` : '—'}
            />
          </dl>
          <div className="mt-3">
            <div className="flex justify-between font-mono text-[10px] text-slate-400">
              <span>BATERIA</span>
              <span className={snap.battery < 0.2 ? 'text-breach' : 'text-slate-300'}>{Math.round(snap.battery * 100)}%</span>
            </div>
            <div className="mt-1 h-1.5 bg-ink">
              <div
                className={`h-full ${snap.battery < 0.2 ? 'bg-breach' : 'bg-nominal'}`}
                style={{ width: `${Math.round(snap.battery * 100)}%` }}
              />
            </div>
          </div>
          <p className="mt-3 font-mono text-[10px] text-slate-500">
            Ponto {snap.waypoint + 1}/{snap.waypointCount} · raio {snap.fenceRadius.toFixed(0)} m
          </p>
        </section>
        <Minimap snap={snap} />
      </aside>

      <footer className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
        <div className="pointer-events-auto flex gap-2 overflow-auto lg:hidden">
          <CompactStat label="ALT" value={`${snap.altitude.toFixed(1)}`} />
          <CompactStat label="VEL" value={`${snap.speed.toFixed(1)}`} />
          <CompactStat label="PROA" value={`${Math.round(snap.headingDeg)}°`} />
          <CompactStat label="BAT" value={`${Math.round(snap.battery * 100)}%`} />
          <CompactStat label="CERC" value={snap.droneInside ? 'OK' : 'FORA'} warn={!snap.droneInside} />
        </div>
        <div className="pointer-events-auto grid grid-cols-4 gap-2 md:hidden">
          <IconButton label="Patrulha" pressed={controls.mode === 'patrol'} onClick={() => patch({ mode: 'patrol', paused: false })}>
            <Radar size={16} />
          </IconButton>
          <IconButton label="Rastrear" pressed={controls.mode === 'track'} onClick={() => onChange(trackNearest(controls, snap))}>
            <Crosshair size={16} />
          </IconButton>
          <IconButton label="Retorno" pressed={controls.mode === 'rtl'} onClick={() => patch({ mode: 'rtl', paused: false })}>
            <House size={16} />
          </IconButton>
          <IconButton label={controls.paused ? 'Retomar' : 'Pausa'} pressed={controls.paused} onClick={() => patch({ paused: !controls.paused })}>
            {controls.paused ? <Play size={16} /> : <Pause size={16} />}
          </IconButton>
        </div>
        <div className="pointer-events-auto grid grid-cols-1 gap-2 sm:grid-cols-3">
          {snap.targets.map((target) => {
            const selected = controls.mode === 'track' && controls.trackId === target.id;
            return (
              <button
                key={target.id}
                type="button"
                aria-pressed={selected}
                onClick={() => patch({ mode: 'track', trackId: target.id, paused: false })}
                className={`flex items-center justify-between gap-2 border px-3 py-2 text-left backdrop-blur-md ${
                  target.outside
                    ? 'border-breach/60 bg-breach/10'
                    : selected
                      ? 'border-caution/70 bg-caution/10'
                      : 'border-line/80 bg-panel/80'
                }`}
              >
                <span className="flex items-center gap-2">
                  {target.kind === 'vehicle' ? <Car size={14} /> : <PersonStanding size={14} />}
                  <span className="font-display text-sm">{target.callsign}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-slate-300">
                  {target.outside ? 'FORA' : 'DENTRO'} · {target.range.toFixed(0)} m
                </span>
              </button>
            );
          })}
        </div>
      </footer>
    </div>
  );
}

function ModeStack({
  controls,
  snap,
  onChange,
}: {
  controls: Controls;
  snap: Telemetry;
  onChange: (next: Controls) => void;
}) {
  const patch = (partial: Partial<Controls>) => onChange({ ...controls, ...partial });
  return (
    <div className="pointer-events-auto flex flex-col gap-2 border border-line/80 bg-panel/80 p-2 backdrop-blur-md">
      <ModeButton
        label="Patrulha"
        hint="1"
        pressed={controls.mode === 'patrol'}
        onClick={() => patch({ mode: 'patrol', paused: false })}
        icon={<Radar size={15} />}
      />
      <ModeButton
        label="Rastrear"
        hint="2"
        pressed={controls.mode === 'track'}
        onClick={() => onChange(trackNearest(controls, snap))}
        icon={<Crosshair size={15} />}
      />
      <ModeButton
        label="Retorno"
        hint="3"
        pressed={controls.mode === 'rtl'}
        onClick={() => patch({ mode: 'rtl', paused: false })}
        icon={<House size={15} />}
      />
      <ModeButton
        label={controls.paused ? 'Retomar' : 'Pausa'}
        hint="espaço"
        pressed={controls.paused}
        onClick={() => patch({ paused: !controls.paused })}
        icon={controls.paused ? <Play size={15} /> : <Pause size={15} />}
      />
    </div>
  );
}

function FenceCard({ controls, onChange }: { controls: Controls; onChange: (next: Controls) => void }) {
  return (
    <section className="pointer-events-auto border border-line/80 bg-panel/80 p-3 backdrop-blur-md">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.16em] text-slate-400">
        <span>PERÍMETRO</span>
        <span className="text-slate-200 tabular-nums">{controls.fenceRadius.toFixed(0)} m</span>
      </div>
      <input
        className="mt-2 w-full"
        type="range"
        min={12}
        max={40}
        step={1}
        value={controls.fenceRadius}
        aria-label="Raio do perímetro em metros"
        onChange={(event) => onChange({ ...controls, fenceRadius: Number(event.target.value) })}
      />
      <button
        type="button"
        aria-pressed={controls.fenceArmed}
        onClick={() => onChange({ ...controls, fenceArmed: !controls.fenceArmed })}
        className={`mt-2 flex w-full items-center justify-center gap-2 border px-2 py-1.5 font-mono text-[11px] ${
          controls.fenceArmed ? 'border-nominal/50 text-nominal' : 'border-breach/50 text-breach'
        }`}
      >
        {controls.fenceArmed ? <Shield size={14} /> : <ShieldOff size={14} />}
        {controls.fenceArmed ? 'Armado' : 'Desarmado'}
      </button>
    </section>
  );
}

function ViewCard({
  controls,
  xrStatus,
  xrBusy,
  onChange,
  onEnterXR,
}: {
  controls: Controls;
  xrStatus: XrStatus;
  xrBusy: boolean;
  onChange: (next: Controls) => void;
  onEnterXR: () => void;
}) {
  return (
    <section className="pointer-events-auto flex flex-col gap-2 border border-line/80 bg-panel/80 p-2 backdrop-blur-md">
      <button
        type="button"
        onClick={() => onChange({ ...controls, camera: controls.camera === 'maquete' ? 'seguir' : 'maquete' })}
        className="flex items-center justify-center gap-2 border border-line px-2 py-1.5 font-mono text-[11px] text-slate-200"
      >
        <Compass size={14} />
        {controls.camera === 'maquete' ? 'Maquete' : 'Seguir drone'}
      </button>
      <button
        type="button"
        onClick={onEnterXR}
        disabled={xrBusy}
        className="flex items-center justify-center gap-2 border border-line px-2 py-1.5 font-mono text-[11px] text-slate-200 disabled:opacity-50"
      >
        <Video size={14} />
        {xrLabel(xrStatus, xrBusy)}
      </button>
    </section>
  );
}

function ModeButton({
  label,
  hint,
  pressed,
  onClick,
  icon,
}: {
  label: string;
  hint: string;
  pressed: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex items-center justify-between px-2 py-1.5 text-left ${
        pressed ? 'bg-nominal/15 text-nominal' : 'text-slate-200 hover:bg-white/5'
      }`}
    >
      <span className="flex items-center gap-2 font-display text-sm">
        {icon}
        {label}
      </span>
      <span className="font-mono text-[10px] text-slate-500">{hint}</span>
    </button>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-10 place-items-center border ${pressed ? 'border-nominal/60 bg-nominal/15 text-nominal' : 'border-line bg-panel/80 text-slate-200'}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wider text-slate-500">{label}</dt>
      <dd className={warn ? 'text-breach' : 'text-slate-100'}>{value}</dd>
    </div>
  );
}

function CompactStat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="border border-line/80 bg-panel/80 px-2 py-1 font-mono text-[10px] tabular-nums">
      <span className="text-slate-500">{label} </span>
      <span className={warn ? 'text-breach' : 'text-slate-100'}>{value}</span>
    </span>
  );
}

function Minimap({ snap }: { snap: Telemetry }) {
  const size = 148;
  const center = size / 2;
  const scale = (center - 16) / 40;
  const project = (east: number, north: number) => ({
    x: center + east * scale,
    y: center - north * scale,
  });
  const drone = project(snap.east, snap.north);
  const calm = snap.droneInside && snap.targets.every((target) => !target.outside);
  return (
    <section className="border border-line/80 bg-panel/80 p-2 backdrop-blur-md">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-36 w-full" role="img" aria-label="Mapa do perímetro">
        <rect width={size} height={size} fill="#091018" />
        <circle cx={center} cy={center} r={snap.fenceRadius * scale} fill="none" stroke={calm ? '#3ee0c5' : '#ff5d73'} strokeWidth="1.5" />
        <text x={center} y="14" textAnchor="middle" fill="#8ea0b3" fontSize="9" fontFamily="ui-monospace, monospace">
          N
        </text>
        {snap.targets.map((target) => {
          const point = project(target.east, target.north);
          const selected = snap.mode === 'track' && snap.trackId === target.id;
          return (
            <circle
              key={target.id}
              cx={point.x}
              cy={point.y}
              r={selected ? 4.2 : 3}
              fill={target.outside ? '#ff5d73' : selected ? '#f5b942' : '#d7e2ec'}
            />
          );
        })}
        <polygon points="0,-6 4.5,5 -4.5,5" transform={`translate(${drone.x} ${drone.y}) rotate(${snap.headingDeg})`} fill="#3ee0c5" />
      </svg>
    </section>
  );
}

function describeAlert(snap: Telemetry): { tone: 'breach' | 'caution'; text: string } | null {
  if (!snap.fenceArmed) return null;
  if (!snap.droneInside) return { tone: 'breach', text: 'Drone fora do perímetro' };
  const outside = snap.targets.filter((target) => target.outside);
  if (outside.length > 0) {
    return { tone: 'breach', text: `Alvo fora: ${outside.map((target) => target.callsign).join(', ')}` };
  }
  if (snap.holdingAtFence) return { tone: 'caution', text: 'Rota bloqueada no limite do perímetro' };
  return null;
}

function trackNearest(controls: Controls, snap: Telemetry): Controls {
  const nearest = snap.targets.slice().sort((a, b) => a.range - b.range)[0];
  return { ...controls, mode: 'track', trackId: controls.trackId ?? nearest?.id ?? null, paused: false };
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function xrLabel(status: XrStatus, busy: boolean): string {
  if (busy) return 'A abrir XR';
  if (status === 'entered') return 'Sessão XR ativa';
  if (status === 'unsupported') return 'XR indisponível';
  if (status === 'denied') return 'XR negado';
  if (status === 'ended') return 'XR encerrado';
  return 'Entrar em XR';
}

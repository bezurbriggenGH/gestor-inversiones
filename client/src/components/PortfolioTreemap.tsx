import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ResponsiveContainer, Treemap } from 'recharts';
import type { PortfolioPosition } from '../api';
import { useSettings } from '../settings';
import { money, pct } from '../format';

type Mode = 'day' | 'total';
const MODES: { key: Mode; label: string; scale: number }[] = [
  { key: 'day', label: 'Hoy', scale: 0.04 }, // ±4% en el día ya es un movimiento fuerte
  { key: 'total', label: 'Desde que compraste', scale: 0.5 },
];

function color(r: number, scale: number) {
  const t = Math.min(1, Math.abs(r) / scale);
  if (Math.abs(r) < 0.0005) return '#2a2b2e';
  // De gris oscuro a verde o rojo intenso
  const [r0, g0, b0] = [35, 36, 39];
  const [r1, g1, b1] = r > 0 ? [63, 130, 86] : [170, 70, 66];
  const mix = (a: number, b: number) => Math.round(a + (b - a) * (0.25 + 0.75 * t));
  return `rgb(${mix(r0, r1)},${mix(g0, g1)},${mix(b0, b1)})`;
}

interface NodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  name: string;
  change: number;
  weight: number;
  value: number;
  scale: number;
  onOpen: (ticker: string) => void;
}

function Node({ x, y, width, height, depth, name, change, weight, scale, onOpen }: NodeProps) {
  if (depth !== 1) return null;
  const big = width > 70 && height > 46;
  const small = width > 38 && height > 22;
  return (
    <g onClick={() => onOpen(name)} style={{ cursor: 'pointer' }}>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={color(change, scale)} stroke="#111213" strokeWidth={3} />
      {small && (
        <text x={x + width / 2} y={y + height / 2 + (big ? -6 : 4)} textAnchor="middle" fill="#fff" fontSize={big ? 15 : 11} fontWeight={600}>
          {name}
        </text>
      )}
      {big && (
        <text x={x + width / 2} y={y + height / 2 + 13} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={12}>
          {pct(change)} · {Math.round(weight * 100)}%
        </text>
      )}
      <title>{`${name}: ${pct(change)} · ${Math.round(weight * 1000) / 10}% de la cartera`}</title>
    </g>
  );
}

/** Mapa de calor: cada activo es un rectángulo del tamaño de tu tenencia, coloreado según cómo le fue. */
export function PortfolioTreemap({ positions }: { positions: PortfolioPosition[] }) {
  const { currency } = useSettings();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('day');
  const { scale } = MODES.find((m) => m.key === mode)!;

  const data = positions
    .filter((p) => p.marketValue > 0)
    .map((p) => ({
      name: p.ticker,
      size: p.marketValue,
      weight: p.weight,
      change: mode === 'day' ? p.dayChangePct : p.unrealizedPct,
    }));

  const total = positions.reduce((s, p) => s + p.marketValue, 0);
  const dayTotal = positions.reduce((s, p) => s + p.dayChange, 0);

  return (
    <section className="rounded-xl bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Mapa de la cartera</h2>
          <p className="text-xs text-muted">
            El tamaño es cuánto tenés invertido; el color, cuánto subió o bajó.
            {mode === 'day' && (
              <>
                {' '}
                Hoy: <span className={dayTotal >= 0 ? 'text-up' : 'text-down'}>{money(dayTotal, currency, true)}</span> sobre{' '}
                {money(total, currency)}.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-bg p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${mode === m.key ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-80">
        <ResponsiveContainer>
          <Treemap
            data={data}
            dataKey="size"
            isAnimationActive={false}
            content={(props: unknown) => <Node {...(props as NodeProps)} scale={scale} onOpen={(t) => navigate(`/activo/${t}`)} />}
          />
        </ResponsiveContainer>
      </div>
    </section>
  );
}

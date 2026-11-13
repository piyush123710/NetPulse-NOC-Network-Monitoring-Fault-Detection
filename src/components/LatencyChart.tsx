import { useState } from 'react';

interface LatencyPoint {
  checked_at: string;
  avg_ms: number | null;
  max_ms: number | null;
  failures: number;
}

interface LatencyChartProps {
  data: LatencyPoint[];
}

export function LatencyChart({ data }: LatencyChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center border border-dashed border-slate-200 rounded-md text-sm text-slate-500">
        Waiting for initial probe telemetry samples...
      </div>
    );
  }

  const width = 760;
  const height = 220;
  const padLeft = 44;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxObserved = Math.max(
    60,
    ...data.map((d) => Math.max(d.avg_ms ?? 0, d.max_ms ?? 0))
  );
  const yMax = Math.ceil(maxObserved / 20) * 20;

  const getX = (index: number) => {
    if (data.length === 1) return padLeft + plotW / 2;
    return padLeft + (index / (data.length - 1)) * plotW;
  };

  const getY = (val: number) => {
    return padTop + plotH - (Math.min(val, yMax) / yMax) * plotH;
  };

  const avgPoints = data
    .map((d, i) => `${getX(i).toFixed(1)},${getY(d.avg_ms ?? 0).toFixed(1)}`)
    .join(' ');

  const maxPoints = data
    .map((d, i) => `${getX(i).toFixed(1)},${getY(d.max_ms ?? 0).toFixed(1)}`)
    .join(' ');

  const areaPath =
    data.length > 0
      ? `M ${getX(0).toFixed(1)},${(padTop + plotH).toFixed(1)} ` +
        data
          .map((d, i) => `L ${getX(i).toFixed(1)},${getY(d.avg_ms ?? 0).toFixed(1)}`)
          .join(' ') +
        ` L ${getX(data.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMax * t));
  const activePoint = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-5 text-xs text-slate-600">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 bg-blue-600" />
            Mean RTT (ms)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 border-t border-dashed border-slate-400" />
            Peak RTT (ms)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 bg-red-600 rotate-45" />
            Interval Fault
          </span>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-600 min-h-[18px]">
          {activePoint ? (
            <span>
              {activePoint.checked_at.slice(11, 16)} UTC · Mean{' '}
              <strong className="text-slate-900">{activePoint.avg_ms ?? '—'}ms</strong> · Peak{' '}
              <strong className="text-slate-900">{activePoint.max_ms ?? '—'}ms</strong>
              {activePoint.failures > 0 ? (
                <span className="text-red-700 font-medium">
                  {' '}
                  · {activePoint.failures} timeout{activePoint.failures > 1 ? 's' : ''}
                </span>
              ) : null}
            </span>
          ) : (
            <span>Hover chart points to inspect interval RTT</span>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-56 select-none overflow-visible"
        role="img"
        aria-label="Network response time history chart"
      >
        <defs>
          <linearGradient id="rttArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = getY(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#rttArea)" />}

        {data.length > 1 && (
          <>
            <polyline
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.25"
              strokeDasharray="4 4"
              points={maxPoints}
            />
            <polyline
              fill="none"
              stroke="#2563eb"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={avgPoints}
            />
          </>
        )}

        {data.map((d, i) => {
          const cx = getX(i);
          const cy = getY(d.avg_ms ?? 0);
          const isHovered = hoveredIdx === i;
          const showLabel =
            i === 0 || i === data.length - 1 || i % Math.max(1, Math.floor(data.length / 5)) === 0;

          return (
            <g key={`${d.checked_at}-${i}`}>
              {isHovered && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={padTop}
                  y2={padTop + plotH}
                  stroke="#cbd5e1"
                  strokeWidth="1"
                />
              )}

              {d.failures > 0 && (
                <rect
                  x={cx - 3.5}
                  y={padTop + plotH - 7}
                  width="7"
                  height="7"
                  transform={`rotate(45 ${cx} ${padTop + plotH - 3.5})`}
                  fill="#dc2626"
                />
              )}

              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 4.5 : 2.5}
                fill={isHovered ? '#1d4ed8' : '#2563eb'}
                stroke="#ffffff"
                strokeWidth="1.5"
              />

              {showLabel && (
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] font-mono"
                >
                  {d.checked_at.slice(11, 16)}
                </text>
              )}

              <rect
                x={cx - plotW / Math.max(data.length * 2, 2)}
                y={padTop}
                width={plotW / Math.max(data.length, 1)}
                height={plotH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

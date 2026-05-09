"use client";

function ScanLines() {
  return (
    <g clipPath="url(#probe-lens-clip)">
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={15}
          y1={10.5 + i * 3.5}
          x2={28}
          y2={10.5 + i * 3.5}
          stroke="currentColor"
          strokeWidth={0.8}
          strokeLinecap="round"
          className="animate-probe-scan"
          style={{ animationDelay: `${1.2 + i * 0.25}s` }}
        />
      ))}
    </g>
  );
}

export function ProbeLogo({ size = "default" }: { size?: "default" | "lg" }) {
  const isLg = size === "lg";
  const svgWidth = isLg ? 80 : 32;
  const svgHeight = isLg ? 70 : 28;

  return (
    <div className={`flex items-center ${isLg ? "gap-5" : "gap-3"}`}>
      <svg
        viewBox="0 0 32 28"
        width={svgWidth}
        height={svgHeight}
        fill="none"
        className="shrink-0 text-zinc-900"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="probe-lens-clip">
            <circle cx={21.5} cy={14} r={6.5} />
          </clipPath>
        </defs>

        <rect x={4} y={5} width={15} height={19} rx={2} className="fill-zinc-100 stroke-zinc-300" strokeWidth={0.6} />
        <rect x={2.5} y={3} width={15} height={19} rx={2} className="fill-zinc-50 stroke-zinc-300" strokeWidth={0.7} />
        <rect x={1} y={1} width={15} height={19} rx={2} className="fill-white stroke-zinc-400" strokeWidth={0.8} />

        <line x1={4} y1={5.5} x2={12} y2={5.5} className="stroke-zinc-300" strokeWidth={1} strokeLinecap="round" />
        <line x1={4} y1={8.5} x2={13} y2={8.5} className="stroke-zinc-200" strokeWidth={1} strokeLinecap="round" />
        <line x1={4} y1={11.5} x2={10.5} y2={11.5} className="stroke-zinc-200" strokeWidth={1} strokeLinecap="round" />
        <line x1={4} y1={14.5} x2={12.5} y2={14.5} className="stroke-zinc-200" strokeWidth={1} strokeLinecap="round" />
        <line x1={4} y1={17.5} x2={9} y2={17.5} className="stroke-zinc-200" strokeWidth={1} strokeLinecap="round" />

        <circle
          cx={21.5}
          cy={14}
          r={6.5}
          className="stroke-zinc-900"
          strokeWidth={1.8}
          fill="none"
        />

        <circle
          cx={21.5}
          cy={14}
          r={3}
          strokeWidth={0.6}
          fill="none"
          className="stroke-zinc-900 animate-probe-pulse"
        />

        <ScanLines />

        <line
          x1={26.2}
          y1={18.8}
          x2={30}
          y2={22.6}
          className="stroke-zinc-900"
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      </svg>

      <div>
        <p className={`uppercase tracking-[0.16em] text-zinc-400 leading-tight ${isLg ? "text-sm" : "text-[10px]"}`}>
          Invariant AI
        </p>
        <p className={`font-semibold tracking-[-0.02em] text-zinc-900 leading-tight mt-0.5 ${isLg ? "text-3xl" : "text-lg"}`}>
          Probe
        </p>
      </div>

      <style>{`
        @keyframes probe-scan {
          0%, 100% { opacity: 0; stroke-dashoffset: 10; }
          30%, 70% { opacity: 0.55; stroke-dashoffset: 0; }
        }
        @keyframes probe-pulse {
          0%, 100% { r: 2.5; opacity: 0.2; }
          50% { r: 4; opacity: 0.35; }
        }
        .animate-probe-scan {
          stroke-dasharray: 10;
          animation: probe-scan 3s ease-in-out infinite;
        }
        .animate-probe-pulse {
          animation: probe-pulse 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

import { badgeText, clampUnit } from "./helpers";

/** Keep the exact anchor visible; move only its label inward at frame edges. */
export default function CommentPin({
  x,
  y,
  label,
  index = 0,
}: {
  x: number;
  y: number;
  label: string;
  index?: number;
}) {
  const left = clampUnit(x);
  const top = clampUnit(y);
  const labelX = left > 0.5 ? -18 : 18;
  const labelY = top > 0.5 ? -20 : 20;
  const draft = label === "+";
  const connector = `M ${labelX * 0.25} ${labelY * 0.25} L ${labelX} ${labelY}`;

  return (
    <svg
      viewBox="-34 -34 68 68"
      role="img"
      aria-label={draft ? "Nuovo commento: punto selezionato" : `Commento ${label}: punto selezionato`}
      data-comment-pin={draft ? "draft" : "saved"}
      className="pointer-events-none absolute z-30 h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 overflow-visible text-accent"
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
    >
      {/* The white underlay keeps the thin connector visible on any photo. */}
      <path d={connector} fill="none" stroke="white" strokeWidth="4" />
      <path d={connector} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx={labelX} cy={labelY} r="13" fill="white" />
      <circle cx={labelX} cy={labelY} r="11" fill={draft ? "currentColor" : "white"} stroke="currentColor" strokeWidth="1.5" />
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={draft ? "white" : "currentColor"}
        fontSize={draft ? "16" : "12"}
        fontWeight="700"
        aria-hidden="true"
      >
        {badgeText(label, index)}
      </text>
      {/* A small hollow target identifies the coordinate without hiding it. */}
      <circle r="4" fill="none" stroke="white" strokeWidth="4" />
      <circle r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

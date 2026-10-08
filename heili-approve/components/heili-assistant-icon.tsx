/** Connected core + three satellites from Heili Core's documented design system. */
export default function HeiliAssistantIcon({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#001F2F" />
      <g stroke="#00E1CD" strokeWidth="1.8" fill="#00E1CD">
        <path d="M32 30 16 21M32 30 47 19M32 30 35 47" fill="none" />
        <circle cx="16" cy="21" r="4.2" />
        <circle cx="47" cy="19" r="4.6" />
        <circle cx="35" cy="47" r="3.8" />
      </g>
      <circle cx="32" cy="30" r="5.4" fill="white" />
    </svg>
  );
}

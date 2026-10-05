/**
 * Inline SVG icons for the network mockups and the video player.
 * Decorative (aria-hidden): every control that uses one carries its own label.
 */

import type { ReactNode } from "react";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function icon(children: ReactNode, filled = false) {
  function Icon({ className = "h-6 w-6" }: { className?: string }) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        className={className}
        {...(filled ? { fill: "currentColor" } : stroke)}
      >
        {children}
      </svg>
    );
  }
  return Icon;
}

export const HeartIcon = icon(
  <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 10-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 000-7.8z" />
);
export const CommentIcon = icon(
  <path d="M21 11.5a8.4 8.4 0 01-9 8.4 9.9 9.9 0 01-4-.8L3 21l1.9-4.5A8.4 8.4 0 013 11.5 8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" />
);
export const SendIcon = icon(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />);
export const BookmarkIcon = icon(<path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />);
export const MoreIcon = icon(
  <>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </>,
  true
);
export const MusicIcon = icon(
  <>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </>
);
export const RepostIcon = icon(
  <path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3" />
);
export const ShareArrowIcon = icon(<path d="M14 5l7 7-7 7M21 12H9a6 6 0 00-6 6v1" />);
export const ThumbIcon = icon(
  <path d="M7 10v11H3V10h4zm0 0l4-8a3 3 0 013 3v4h5.5a2 2 0 012 2.3l-1.4 8A2 2 0 0118.1 21H7" />
);
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
  </>
);
export const ChartIcon = icon(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const ChevronLeftIcon = icon(<path d="M15 18l-6-6 6-6" />);
export const ChevronRightIcon = icon(<path d="M9 18l6-6-6-6" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const CameraIcon = icon(
  <>
    <path d="M3 8a2 2 0 012-2h1.2a2 2 0 001.7-1l.5-.8a2 2 0 011.7-1h3.8a2 2 0 011.7 1l.5.8a2 2 0 001.7 1H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <circle cx="12" cy="13" r="3.2" />
  </>
);
export const PinMapIcon = icon(
  <>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>
);

// Player controls (filled, read at small sizes over video).
export const PlayIcon = icon(<path d="M7 4.5v15a1 1 0 001.5.9l12-7.5a1 1 0 000-1.8l-12-7.5A1 1 0 007 4.5z" />, true);
export const PauseIcon = icon(
  <>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </>,
  true
);
export const BackSecondIcon = icon(
  <>
    <path d="M4 12a8 8 0 108-8H8" />
    <path d="M10 1L7 4l3 3" />
  </>
);
export const ForwardSecondIcon = icon(
  <>
    <path d="M20 12a8 8 0 11-8-8h4" />
    <path d="M14 1l3 3-3 3" />
  </>
);

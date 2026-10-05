/**
 * PostPreview — how a post will look on one network.
 *
 * Realistic, sober mockups of the real apps: what the client approves (on
 * a phone, mostly) and what the agency checks while editing. Not a client
 * component itself: the mockups are plain markup and only the interactive
 * pieces (caption expander, media carousel, video player) are client
 * components, so it also renders from server components (without the
 * callback props).
 */

import { feedLayoutComponents } from "./registry";
import { layoutFor } from "./helpers";
import type { PostPreviewProps } from "./types";

export default function PostPreview({ network, format, className = "", ...props }: PostPreviewProps) {
  const Mockup = feedLayoutComponents[layoutFor(network, format)];
  return (
    <div className={`w-full min-w-0 ${className}`}>
      <Mockup {...props} media={props.media ?? []} text={props.text ?? ""} />
    </div>
  );
}

export { PostPreview };

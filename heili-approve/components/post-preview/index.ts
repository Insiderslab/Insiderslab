/**
 * Post previews (module D). Import from "@/components/post-preview".
 */

export { default as PostPreview } from "./post-preview";
export { default as NetworkPreviewTabs, type NetworkPreviewTabsProps } from "./network-tabs";
export {
  default as VideoPlayer,
  type VideoPlayerProps,
  type VideoPlayerMarker,
  type VideoPlayerPin,
} from "./video-player";
export type {
  MediaClickPoint,
  PostPreviewProps,
  PreviewPin,
  PreviewSeek,
  PreviewVideoMarker,
  VideoCommentRequest,
  VideoMarker,
  VideoReviewProps,
} from "./types";
export { formatFromOptions, formatLabel, layoutFor, type PreviewLayout } from "./helpers";

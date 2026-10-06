/**
 * Ad creative components (Post.kind = AD_CREATIVE).
 *
 * Bundle note: the editor pulls in the media uploader; in the client portal
 * import AdVariantReview / AdVariantCompare from their own files rather than
 * from this barrel.
 */

export { default as AdSetEditor, type AdSetEditorProps } from "./ad-set-editor";
export { default as AdPreview, AdPlacementPreviews, type AdPreviewProps, type AdPlacementPreviewsProps } from "./ad-preview";
export { default as AdVariantReview, type AdVariantReviewProps, type AdCommentRequest } from "./ad-variant-review";
export { default as AdVariantCompare, type AdVariantCompareProps } from "./ad-variant-compare";
export {
  default as AdDecisionBadge,
  DECISION_LABELS,
  type AdVariantDecisionState,
  type AdVerdict,
} from "./decision-badge";
export { default as AdSpecChecklist, CheckStatusChip } from "./spec-checklist";
export { default as SafeZoneOverlay } from "./safe-zones";
export type { AdMockupProps } from "./ad-mockups";
export {
  commentMoment,
  displayDomain,
  markersForComments,
  numberAdComments,
  pinsForComments,
  type AdReviewComment,
  type NumberedComment,
} from "./helpers";

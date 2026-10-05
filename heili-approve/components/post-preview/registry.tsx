/**
 * Layout → mockup component. Kept apart from PostPreview so the mapping is
 * exhaustive (adding a PreviewLayout without a mockup fails typecheck).
 */

import type { ComponentType } from "react";
import { FacebookPost, InstagramFeed, LinkedInPost } from "./feed-cards";
import type { PreviewLayout } from "./helpers";
import { GoogleBusinessPost, PinterestPin, YouTubeVideo } from "./other-cards";
import { BlueskyPost, ThreadsPost, XPost } from "./text-cards";
import type { MockupProps } from "./types";
import { ReelMockup, StoryMockup, TikTokMockup, YouTubeShortMockup } from "./vertical";

function InstagramReel(props: MockupProps) {
  return <ReelMockup {...props} variant="instagram" />;
}
function InstagramStory(props: MockupProps) {
  return <StoryMockup {...props} variant="instagram" />;
}
function FacebookReel(props: MockupProps) {
  return <ReelMockup {...props} variant="facebook" />;
}
function FacebookStory(props: MockupProps) {
  return <StoryMockup {...props} variant="facebook" />;
}

export const feedLayoutComponents: Record<PreviewLayout, ComponentType<MockupProps>> = {
  "instagram-feed": InstagramFeed,
  "instagram-reel": InstagramReel,
  "instagram-story": InstagramStory,
  "facebook-post": FacebookPost,
  "facebook-reel": FacebookReel,
  "facebook-story": FacebookStory,
  linkedin: LinkedInPost,
  tiktok: TikTokMockup,
  twitter: XPost,
  threads: ThreadsPost,
  bluesky: BlueskyPost,
  pinterest: PinterestPin,
  "youtube-video": YouTubeVideo,
  "youtube-short": YouTubeShortMockup,
  gmb: GoogleBusinessPost,
};

import type { NavView, ReplyBucket } from "@/lib/types";

export const NAV_ITEMS: Array<{ id: NavView; label: string; helper: string }> = [
  {
    id: "unsent",
    label: "Unsent",
    helper: "Public company emails ready or blocked for outreach",
  },
  {
    id: "sent",
    label: "Sent",
    helper: "Everything already emailed from this workspace",
  },
  {
    id: "replies",
    label: "Replies",
    helper: "Companies that replied, bucketed by outcome",
  },
];

export const REPLY_BUCKETS: Array<{ id: ReplyBucket; label: string }> = [
  { id: "yes", label: "Yes" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "No" },
  { id: "needs_reply", label: "No Reply Yet" },
];

export const DISCOVERY_QUERIES = [
  "AI startup contact email",
  "founder-led AI company contact page",
  "small AI tools startup careers contact",
  "machine learning startup team inbox",
  "applied AI company contact us",
];

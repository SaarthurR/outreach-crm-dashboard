import type { NavView, ReplyBucket } from "@/lib/types";

export const NAV_ITEMS: Array<{ id: NavView; label: string; helper: string }> = [
  {
    id: "unsent",
    label: "Queue",
    helper: "Contacts imported and ready to email",
  },
  {
    id: "sent",
    label: "Sent",
    helper: "Everything already emailed from this workspace",
  },
  {
    id: "replies",
    label: "Inbox",
    helper: "Replies and sent threads waiting on a response",
  },
  {
    id: "blast",
    label: "Blast",
    helper: "Paste a list, paste an email, send it to everyone",
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

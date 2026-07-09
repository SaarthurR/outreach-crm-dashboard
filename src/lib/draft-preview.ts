import type { OutreachThread } from "@/lib/types";

export function getLeadDraftPreview(
  thread: Pick<OutreachThread, "subject" | "draftBody"> | null | undefined,
) {
  const subject = thread?.subject?.trim();
  const body = thread?.draftBody?.trim();

  if (!subject || !body) {
    return null;
  }

  return {
    subject,
    body,
  };
}

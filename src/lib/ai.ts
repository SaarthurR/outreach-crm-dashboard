import { addDays } from "date-fns";

import { leadCompanyName } from "@/lib/company-name";
import { buildDraftPersonalization } from "@/lib/draft-personalization";
import { env } from "@/lib/env";
import type { Lead, OutreachThread, ProfileSettings, ReplyBucket } from "@/lib/types";

export function outreachSubject(companyName: string) {
  return `Interested in Learning More About Internship Opportunities at ${companyName}`;
}

const CONTACT_PHONE = "+1 650 441 7661";
const PERSONAL_WEBSITE = "saarth-site.vercel.app";
const BIRTH_DATE = new Date("2012-04-12T00:00:00Z");

export function ageOn(date = new Date()) {
  let age = date.getUTCFullYear() - BIRTH_DATE.getUTCFullYear();
  const beforeBirthday =
    date.getUTCMonth() < BIRTH_DATE.getUTCMonth() ||
    (date.getUTCMonth() === BIRTH_DATE.getUTCMonth() && date.getUTCDate() < BIRTH_DATE.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

const NON_PERSON_CONTACT =
  /^(founding|founders?|team|support|contact|info|hello|sales|careers|hiring|admin|recruiting|press|the)\b/i;

function greetingFor(lead: Lead) {
  const first = lead.contactName?.trim().split(/\s+/)[0] ?? null;
  return first && !NON_PERSON_CONTACT.test(first) ? `Hi ${first},` : "Hi there,";
}

function stripDashes(text: string) {
  return text
    .replace(/\s*(?:--|\u2014|\u2013)\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,(\s*[.!?])/g, "$1");
}

/** The fixed body. `drawnTo` is the only sentence that changes per company. */
export function buildOutreachBody(lead: Lead, settings: ProfileSettings, drawnTo: string) {
  const companyName = leadCompanyName(lead);
  return stripDashes(
    [
      greetingFor(lead),
      "",
      `I hope you're doing well. My name is ${settings.fullName}, and I'm currently a freshman at ${settings.schoolName} in ${settings.city}. Last summer I interned at two YC companies, DeepAware AI in San Francisco and Frizzle AI, working on robot teleoperation software and cold outreach campaigns. I was searching for internships this summer and came across ${companyName} in the YC directory, and I'd love to learn more about any opportunities you might offer for students like me.`,
      "",
      `I'm particularly drawn to ${drawnTo}, and I'm eager to gain real-world experience, contribute in any way I can, and continue learning.`,
      "",
      "If you're able to share anything about potential internships, job shadowing, or even volunteer roles, including what the process looks like and what you typically look for, I'd be really grateful.",
      "",
      "Thanks so much for your time, and I'd appreciate the chance to connect or hear from you if possible.",
      "",
      "Warmly,",
      settings.fullName,
      env.authorizedGmailAddress,
      CONTACT_PHONE,
      PERSONAL_WEBSITE,
    ]
      .filter((line): line is string => Boolean(line) || line === "")
      .join("\n"),
  );
}

export async function generateOutreachDraft(lead: Lead, settings: ProfileSettings) {
  const personalization = await buildDraftPersonalization(lead);

  return {
    subject: outreachSubject(leadCompanyName(lead)),
    body: buildOutreachBody(lead, settings, personalization.drawnTo),
    personalization: personalization.reason,
    followUpNote: `Follow up around ${addDays(new Date(), settings.followUpWindowDays).toDateString()}.`,
  };
}

export function classifyReply(
  _thread: Pick<OutreachThread, "subject" | "companyName">,
  replyText: string,
): { bucket: ReplyBucket; summary: string; reason: string } {
  const text = replyText.toLowerCase();

  if (/(bounce|undeliverable|mail delivery failed|address not found|550 |554 )/.test(text)) {
    return {
      bucket: "no",
      summary: "Delivery failed or mailbox unavailable.",
      reason: "Detected bounce or delivery-failure language.",
    };
  }

  if (/(no|not a fit|unfortunately|we are not hiring|can't|not interested|stop emailing|unsubscribe)/.test(text)) {
    return {
      bucket: "no",
      summary: "This looks like a clear rejection or no-openings response.",
      reason: "Detected negative or closed-door language.",
    };
  }

  if (/(interested|let's talk|sounds good|send more|availability|resume|happy to chat|would love to)/.test(text)) {
    return {
      bucket: "yes",
      summary: "This reply shows active interest and asks for next-step information.",
      reason: "Detected positive intent and a concrete follow-up ask.",
    };
  }

  if (/(later|future|keep in touch|another inbox|someone else|try|not right now|circle back)/.test(text)) {
    return {
      bucket: "maybe",
      summary: "This reply is warm but not an immediate yes.",
      reason: "Detected deferment or redirection language.",
    };
  }

  return {
    bucket: "needs_reply",
    summary: "New reply — open in Gmail to read and respond.",
    reason: "No clear yes/no outcome keywords were found.",
  };
}

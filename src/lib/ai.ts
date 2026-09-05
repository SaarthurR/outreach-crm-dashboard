import { addDays } from "date-fns";
import { generateText, Output } from "ai";
import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { leadCompanyName } from "@/lib/company-name";
import { buildDraftPersonalization } from "@/lib/draft-personalization";
import { getVipContext } from "@/lib/vip-context";
import { env, isAiConfigured } from "@/lib/env";

function isGroqConfigured() {
  return Boolean(env.groqApiKey);
}
import type { Lead, OutreachThread, ProfileSettings, ReplyBucket } from "@/lib/types";

const replyOutputSchema = z.object({
  bucket: z.enum(["needs_reply", "yes", "maybe", "no"]),
  summary: z.string(),
  reason: z.string(),
});

// The subject line is the single biggest lever on open rate. "Internship Inquiry"
// reads as mass mail; this one is specific and survives the inbox preview.
// The template Saarth chose, followed exactly. Only two things vary per company:
// its name, and the one sentence saying what specifically drew him to it.
export function outreachSubject(companyName: string) {
  return `Interested in Learning More About Internship Opportunities at ${companyName}`;
}

// Age comes from the date of birth so the email can never claim the wrong one.
const CONTACT_PHONE = "+1 650 441 7661";

const BIRTH_DATE = new Date("2012-04-12T00:00:00Z");

export function ageOn(date = new Date()) {
  let age = date.getUTCFullYear() - BIRTH_DATE.getUTCFullYear();
  const beforeBirthday =
    date.getUTCMonth() < BIRTH_DATE.getUTCMonth() ||
    (date.getUTCMonth() === BIRTH_DATE.getUTCMonth() && date.getUTCDate() < BIRTH_DATE.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// contactName is often a role ("Founding team", "Support"), not a person. Greeting a
// company with "Hi Founding," is worse than not using a name at all.
const NON_PERSON_CONTACT =
  /^(founding|founders?|team|support|contact|info|hello|sales|careers|hiring|admin|recruiting|press|the)\b/i;

function greetingFor(lead: Lead) {
  const first = lead.contactName?.trim().split(/\s+/)[0] ?? null;
  return first && !NON_PERSON_CONTACT.test(first) ? `Hi ${first},` : "Hi there,";
}

// Every em dash and en dash out, in the body and in anything scraped into it.
// Saarth's voice rules ban them outright.
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
      `I hope you're doing well. My name is ${settings.fullName}, and I'm currently a freshman at ${settings.schoolName}. Last summer I interned at two YC companies, DeepAware and Frizzle AI, working on robot teleoperation software and cold outreach campaigns. I was searching for internships this summer and came across ${companyName} in the YC directory, and I'd love to learn more about any opportunities you might offer for students like me.`,
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
    ]
      // Drop only a missing sign-off address. The empty strings between paragraphs
      // are the paragraph breaks, and the HTML part needs them.
      .filter((line): line is string => Boolean(line) || line === "")
      .join("\n"),
  );
}

async function fallbackDraft(lead: Lead, settings: ProfileSettings) {
  const personalization = await buildDraftPersonalization(lead);

  return {
    subject: outreachSubject(leadCompanyName(lead)),
    body: buildOutreachBody(lead, settings, personalization.drawnTo),
    personalization: personalization.reason,
    followUpNote: `Follow up around ${addDays(new Date(), settings.followUpWindowDays).toDateString()}.`,
  };
}

function fallbackClassification(replyText: string): {
  bucket: ReplyBucket;
  summary: string;
  reason: string;
} {
  const text = replyText.toLowerCase();

  if (/(no|not a fit|unfortunately|we are not hiring|can't)/.test(text)) {
    return {
      bucket: "no",
      summary: "This looks like a clear rejection or no-openings response.",
      reason: "Detected negative or closed-door language.",
    };
  }

  if (/(interested|let's talk|sounds good|send more|availability|resume)/.test(text)) {
    return {
      bucket: "yes",
      summary: "This reply shows active interest and asks for next-step information.",
      reason: "Detected positive intent and a concrete follow-up ask.",
    };
  }

  if (/(later|future|keep in touch|another inbox|someone else|try)/.test(text)) {
    return {
      bucket: "maybe",
      summary: "This reply is warm but not an immediate yes.",
      reason: "Detected deferment or redirection language.",
    };
  }

  return {
    bucket: "needs_reply",
    summary: "This message likely needs a human response and review.",
    reason: "No clear yes/no outcome keywords were found.",
  };
}

// Saarth's banned-word list, verbatim from 00_Resources/response-shape.md, plus the
// stock cold-email tells. The model never writes the email, only one clause of it,
// and anything on this list sends that clause back to the deterministic fallback.
const AI_TELLS = [
  "additionally","alternatively","amongst","arguably","as a professional","bridging","bustling",
  "compelling","consequently","crucial","cutting-edge","daunting","delve","dilemma","dive into",
  "elevate","embark","emphasize","ensure","essentially","ever-evolving","evolving","excels",
  "foster","furthermore","game-changing","groundbreaking","harness","immense","in the realm",
  "in today's","indelible","innovative","intricate","journey","keen","landscape","leverage",
  "meticulous","moreover","navigating","nestled","orchestrate","paramount","passionate","pivotal",
  "profoundly","realm","relentless","reshape","revolutionize","robust","seamless","seismic",
  "showcase","spearhead","subsequently","synergy","tapestry","testament","thrilled","transformative",
  "ultimately","underscore","unleash","unlock","unprecedented","unveil","vibrant","vital",
  "excited","exciting","impressive","mission","cutting edge","commitment to","dedication to",
];

function readsAsAi(text: string) {
  const lower = text.toLowerCase();
  return (
    AI_TELLS.some((word) => lower.includes(word)) ||
    /[\u2014\u2013]/.test(text) ||
    text.split(/\s+/).length > 32 ||
    /^i(?:'m| am)\b/i.test(text.trim()) ||
    /\.\s/.test(text.trim())
  );
}

export async function generateOutreachDraft(lead: Lead, settings: ProfileSettings) {
  if (!isGroqConfigured() && !isAiConfigured()) {
    return fallbackDraft(lead, settings);
  }

  const personalization = await buildDraftPersonalization(lead);
  const vip = getVipContext(lead.domain);

  const companyContext = [
    `Company: ${leadCompanyName(lead)}`,
    `Website: ${lead.website}`,
    vip ? `What they do: ${vip.whatTheyDo}` : personalization.detail ? `What they do: ${personalization.detail}` : null,
    personalization.roleDetail ? `Team focus: ${personalization.roleDetail}` : null,
    `How found: ${lead.source}`,
    vip ? `Specific things Saarth finds interesting: ${vip.specificInterest}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const prompt = `Fill in ONE blank in a fixed email template. Output that clause only.

The sentence it drops into, exactly:
"I'm particularly drawn to ____, and I'm eager to gain real-world experience, contribute in any way I can, and continue learning."

The writer is ${settings.fullName}, a ${ageOn()} year old high school freshman.

COMPANY:
${companyContext}

Write the blank so it names something SPECIFIC about this company: what they actually
build, a real problem they are solving, or a concrete result. Use what you already know
about this company if you know it. If the context is too thin to say anything specific,
write what they build in plain words instead of guessing at a detail.

RULES:
- Under 25 words. One clause. No full sentence, no period at the end.
- It must read on naturally from "I'm particularly drawn to".
- Plain words a 14 year old would actually say out loud.
- NEVER use any of these, they are the words that make writing sound like a chatbot:
  ${AI_TELLS.join(", ")}
- No em dashes or en dashes. No quotes. No company tagline copied word for word.
- No flattery that would be true of any company ("the great work you're doing").
- Do not mention his age, his internships, or ask for anything. That is elsewhere in the email.

Good: "how you're getting language models to run on a phone without draining the battery"
Bad: "your innovative approach to on-device AI and your commitment to excellence"

Output the clause only, nothing else.`;

  try {
    const model = isAiConfigured() ? openai("gpt-4o") : groq("llama-3.3-70b-versatile");
    const { text } = await generateText({ model, prompt });
    const clause = text.trim().replace(/^["']|["'.]+$/g, "").trim();

    if (!clause || readsAsAi(clause)) {
      return fallbackDraft(lead, settings);
    }

    return {
      subject: outreachSubject(leadCompanyName(lead)),
      body: buildOutreachBody(lead, settings, clause),
      personalization: `Blank filled by ${isAiConfigured() ? "gpt-4o" : "groq/llama-3.3-70b"}. ${personalization.reason}`,
      followUpNote: `Follow up around ${addDays(new Date(), settings.followUpWindowDays).toDateString()}.`,
    };
  } catch {
    return fallbackDraft(lead, settings);
  }
}

export async function classifyReply(thread: Pick<OutreachThread, "subject" | "companyName">, replyText: string) {
  if (!isAiConfigured() || !env.openAiApiKey) {
    return fallbackClassification(replyText);
  }

  const prompt = [
    "Classify this inbound outreach reply for a cold-email internship CRM.",
    "Buckets: needs_reply, yes, maybe, no.",
    "Return a short summary and a reason.",
    "",
    `Thread: ${thread.subject} / ${thread.companyName}`,
    `Reply: ${replyText}`,
  ].join("\n");

  const { output } = await generateText({
    model: openai("gpt-5"),
    prompt,
    output: Output.object({
      schema: replyOutputSchema,
    }),
  });

  return output;
}

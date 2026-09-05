import { addDays } from "date-fns";
import { generateText, Output } from "ai";
import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

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
// Named after the company so it does not read as a blast, and it says what it is.
export function outreachSubject(companyName: string) {
  return `Internship opportunities at ${companyName} this summer?`;
}

// The one paragraph that changed between the 2026 round and this one. Everything
// else in a cold email is framing; this is the evidence.
// One line, not a paragraph. It has to establish he is worth reading and then get
// out of the way, because the next line is the one that earns the reply.
// Age comes from the date of birth so the email can never claim the wrong one.
const BIRTH_DATE = new Date("2012-04-12T00:00:00Z");

export function ageOn(date = new Date()) {
  let age = date.getUTCFullYear() - BIRTH_DATE.getUTCFullYear();
  const beforeBirthday =
    date.getUTCMonth() < BIRTH_DATE.getUTCMonth() ||
    (date.getUTCMonth() === BIRTH_DATE.getUTCMonth() && date.getUTCDate() < BIRTH_DATE.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function credibilityLine(settings: ProfileSettings) {
  return [
    `My name is ${settings.fullName}. I'm ${ageOn()} and a freshman at ${settings.schoolName} in ${settings.city}.`,
    "This summer I wrote control software for the robot arms at DeepAware AI in SF, and built the cold email infrastructure at Frizzle (YC S25).",
  ].join(" ");
}

// The direct ask, with a smaller version of itself attached so a "no" on the full
// internship does not end the thread.
const INTERNSHIP_ASK =
  "I wanted to ask if you have any internship openings for this summer, or something smaller to start, like a trial project. Happy to take one task first so you can see the work.";

// contactName is often a role ("Founding team", "Support"), not a person. Greeting a
// company with "Hi Founding," is worse than not using a name at all.
const NON_PERSON_CONTACT = /^(founding|founders?|team|support|contact|info|hello|sales|careers|hiring|admin|recruiting|press|the)\b/i;

function greetingFor(lead: Lead) {
  const first = lead.contactName?.trim().split(/\s+/)[0] ?? null;
  return first && !NON_PERSON_CONTACT.test(first) ? `Hi ${first},` : "Hi,";
}

export function normalizeDraftGreeting(body: string) {
  const normalizedBody = body.replace(/\r\n/g, "\n").trim();

  if (!normalizedBody) {
    return "Hi,";
  }

  const lines = normalizedBody.split("\n");

  if (/^(?:hi|hello|hey|dear)\b/i.test(lines[0] ?? "")) {
    return lines.join("\n");
  }

  return ["Hi,", "", normalizedBody].join("\n");
}

function normalizeDraftPunctuation(body: string) {
  // Saarth's voice rules ban em dashes. Scraped copy contains them without
  // surrounding spaces, so match the dash itself, not a spaced-out version of it.
  return body
    .replace(/\s*(?:--|—|–)\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",");
}

function joinDraftLines(lines: Array<string | null | undefined>) {
  return lines.filter((line): line is string => line !== null && line !== undefined).join("\n");
}

async function buildTemplate(lead: Lead, settings: ProfileSettings) {
  const personalization = await buildDraftPersonalization(lead);
  const firstName = settings.firstName || settings.fullName;
  const observation = personalization.detail
    ? `I saw ${personalization.companyName} is ${clipDetail(personalization.detail)}`
    : `I found ${personalization.companyName} through YC`;

  return {
    body: joinDraftLines([
      greetingFor(lead),
      "",
      credibilityLine(settings),
      "",
      `${observation}, which ${personalization.connectionLine}.`,
      "",
      INTERNSHIP_ASK,
      "",
      "Thanks for your time either way, and I can work around your schedule.",
      "",
      firstName,
    ]),
    personalization,
  };
}

function clipDetail(value: string) {
  const firstClause = (value.split(/(?<=[.!?])\s+/)[0] ?? value).replace(/[.!?]+$/, "").trim();
  const clipped =
    firstClause.length > 70 ? firstClause.slice(0, 70).replace(/[\s,;:]+\S*$/, "") : firstClause;
  return /^[A-Z]{2,}/.test(clipped) ? clipped : clipped.charAt(0).toLowerCase() + clipped.slice(1);
}

async function fallbackDraft(lead: Lead, settings: ProfileSettings) {
  const template = await buildTemplate(lead, settings);
  const personalization = template.personalization.reason;

  return {
    subject: outreachSubject(lead.companyName),
    body: normalizeDraftPunctuation(normalizeDraftGreeting(template.body)),
    personalization,
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

export async function generateOutreachDraft(lead: Lead, settings: ProfileSettings) {
  if (!isGroqConfigured() && !isAiConfigured()) {
    return fallbackDraft(lead, settings);
  }

  const personalization = await buildDraftPersonalization(lead);
  const vip = getVipContext(lead.domain);

  const companyContext = [
    `Company: ${personalization.companyName}`,
    vip
      ? `What they do: ${vip.whatTheyDo}`
      : personalization.detail
        ? `What they do: ${personalization.detail}`
        : null,
    personalization.roleDetail ? `Open roles / team focus: ${personalization.roleDetail}` : null,
    lead.contactName ? `Contact name: ${lead.contactName}` : null,
    `How found: ${lead.source}`,
    vip ? `Saarth's direct connection: ${vip.saarthConnection}` : null,
    vip ? `Specific things he finds interesting: ${vip.specificInterest}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const accomplishments = settings.accomplishments.slice(0, 4).join("\n- ");

  const firstName = settings.firstName || settings.fullName;
  const contactFirst = lead.contactName ? lead.contactName.split(" ")[0] : null;
  const greeting = contactFirst ? `Hi ${contactFirst} -` : "Hey there -";

  const prompt = `Write a cold email from ${settings.fullName}, ${ageOn()}, a freshman at ${settings.schoolName} in ${settings.city}, asking about a summer internship.

HARD LIMIT: 120 words in the body. Five short paragraphs.

STRUCTURE, in this order, blank line between each:

1. "${greeting}"

2. Who he is, two sentences: "My name is ${settings.fullName}. I'm ${ageOn()} and a freshman at ${settings.schoolName} in ${settings.city}." Then the two internships below, one clause each. Do not expand them. Never mention the conference, the 200 people, or any award. It makes the email about him instead of them.

3. The paragraph that earns the reply. Name ONE specific thing this company or person did, from the context below. Not their category, not their tagline, not their job title, and not something true of every company in their space. Then say why it caught his attention, tied to a real thread back to his own work, and end on the part he does not know yet. A real open question beats a compliment.

4. The ask, direct: whether they have internship openings for this summer, or something smaller to start such as a trial project. Then offer to take one concrete task first so they can see the work. Do not mention pay in any direction.

5. "Thanks for your time either way, and happy to work around your schedule."

6. "${firstName}"

WHAT HE ACTUALLY DID (never invent anything outside this list):
- DeepAware AI, San Francisco, summer 2026, in person. Control software, motors and assembly for their OpenArm robot arms.
- Frizzle (YC S25), summer 2026, remote. Built their cold email infrastructure, about 1,000 sends a day.
- Solo, AI assisted: three command line tools for his school, a grades dashboard his classmates use, a ride app he runs a six person team on. Trades futures with his own strategies.
${accomplishments ? `- Older: ${accomplishments}` : ""}

COMPANY:
${companyContext}

BANNED, these are what make an email look automated:
- em dashes. Use commas, periods or parentheses.
- passionate, excited, thrilled, opportunity to, leverage, robust, journey, delve, landscape, reach out, hope this finds you well, pick your brain, I know I'm young, I know my age makes this unusual, unpaid, free
- apologising for his age. State it once as a fact and move on.
- flattery true of any company ("love what you're building").
- more than one ask.
- links, attachments, bullet lists, a P.S., a "Best," before the name.

STYLE: short sentences, plain words, first person, sounds like a person typing quickly and carefully. Warm at the close, not cold. Output the email body only, no subject line, no commentary.`;

  try {
    const model = isAiConfigured()
      ? openai("gpt-4o")
      : groq("llama-3.3-70b-versatile");

    const { text } = await generateText({ model, prompt });

    const cleaned = normalizeDraftPunctuation(normalizeDraftGreeting(text.trim()));

    return {
      subject: outreachSubject(lead.companyName),
      body: cleaned,
      personalization: `AI-generated (${isAiConfigured() ? "gpt-4o" : "groq/llama-3.3-70b"}). ${personalization.reason}`,
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

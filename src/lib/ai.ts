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

type DraftTemplateVariant = "technical" | "general";

// The subject line is the single biggest lever on open rate. "Internship Inquiry"
// reads as mass mail; this one is specific and survives the inbox preview.
export const OUTREACH_SUBJECT = "intern next summer? (14, shipped at 2 startups)";

// The one paragraph that changed between the 2026 round and this one. Everything
// else in a cold email is framing; this is the evidence.
const CREDIBILITY_LINE =
  "I spent this summer at two startups. At DeepAware AI in SF I worked on the motors, assembly and control software for their OpenArm robot arms, and ran the arms table at their conference in front of about 200 people. At Frizzle (YC S25) I built the cold email infrastructure they ran at around 1,000 sends a day.";

const SOLO_WORK_LINE =
  "On my own I ship with AI tools. Two school CLIs, a Schoology dashboard, and a ride app I run a six person team on.";

function greetingFor(lead: Lead) {
  const first = lead.contactName ? lead.contactName.split(" ")[0] : null;
  return first ? `Hi ${first},` : "Hi,";
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

function chooseTemplateVariant(lead: Lead): DraftTemplateVariant {
  const signal = [lead.companyType, lead.source, lead.notes, lead.contactEmail].join(" ").toLowerCase();

  if (
    /(founder|developer|tool|agent|research|infra|infrastructure|api|workflow|automation|trading|llm|model|platform)/.test(
      signal,
    )
  ) {
    return "technical";
  }

  return "general";
}

function joinDraftLines(lines: Array<string | null | undefined>) {
  return lines.filter((line): line is string => line !== null && line !== undefined).join("\n");
}

async function buildTechnicalTemplate(lead: Lead, settings: ProfileSettings) {
  const personalization = await buildDraftPersonalization(lead);
  const firstName = settings.firstName || settings.fullName;
  const contextLine =
    personalization.introLine ?? `I came across ${personalization.companyName} and wanted to write.`;

  return {
    body: joinDraftLines([
      `${greetingFor(lead)}\n\nI'm ${settings.fullName}, 14, from ${settings.city}. ${contextLine}`,
      "",
      CREDIBILITY_LINE,
      "",
      personalization.offerLine,
      "",
      "I'd like to do a summer internship with you next year.",
      "",
      "Can I send you the two things I shipped?",
      "",
      "Best,",
      firstName,
    ]),
    personalization,
  };
}

async function buildGeneralTemplate(lead: Lead, settings: ProfileSettings) {
  const personalization = await buildDraftPersonalization(lead);
  const firstName = settings.firstName || settings.fullName;
  const contextLine =
    personalization.introLine ?? `I came across ${personalization.companyName} and wanted to write.`;

  return {
    body: joinDraftLines([
      `${greetingFor(lead)}\n\nI'm ${settings.fullName}, 14, from ${settings.city}. ${contextLine}`,
      "",
      CREDIBILITY_LINE,
      "",
      SOLO_WORK_LINE,
      "",
      personalization.offerLine,
      "",
      "I'd like to do a summer internship with you next year.",
      "",
      "Can I send you the two things I shipped?",
      "",
      "Best,",
      firstName,
    ]),
    personalization,
  };
}

async function fallbackDraft(lead: Lead, settings: ProfileSettings) {
  const variant = chooseTemplateVariant(lead);
  const template = variant === "technical" ? await buildTechnicalTemplate(lead, settings) : await buildGeneralTemplate(lead, settings);
  const personalization =
    variant === "technical"
      ? `Chose the more technical version. ${template.personalization.reason}`
      : `Chose the broader version. ${template.personalization.reason}`;

  return {
    subject: OUTREACH_SUBJECT,
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

  const prompt = `Write a cold email from ${settings.fullName}, 14, from ${settings.city}, asking about a summer internship.

HARD LIMIT: 110 words in the body. Shorter is better. A founder must be able to read and reply in 45 seconds.

WHAT HE ACTUALLY DID (use these, do not soften them, do not invent anything else):
- DeepAware AI, San Francisco, June to August 2026. In person. Worked on motors, assembly and control software for their OpenArm robot arms. Ran the arms table solo at their Builders Conference in front of about 200 people.
- Frizzle (YC S25), May to August 2026, remote. Built their cold email infrastructure, about 1,000 sends a day, plus a grant scraper and a writing tool.
- Solo, AI assisted: two command line tools for his school, a Schoology dashboard, and a ride sharing app he runs a six person team on.
${accomplishments ? `- Older: ${accomplishments}` : ""}

COMPANY:
${companyContext}

STRUCTURE, in this order, blank line between each:
1. "${greeting}"
2. One sentence: name, 14, ${settings.city}. Then one sentence on what this company does, only if the context above states it clearly. If it is vague, write "what you're building" instead. Naming their product wrong is worse than being vague.
3. The two internships, in one short paragraph. Lead with whichever one maps closer to this company. If neither maps, still include both, they are the point of the email.
4. ONE thing he could help with here. One. Not a list.
5. "I'd like to do a summer internship with you next year."
6. A single low effort closing question, such as "Can I send you the two things I shipped?"
7. "Best,\n${firstName}"

BANNED, these are what make an email look automated:
- em dashes. Use commas, periods or parentheses.
- the words: passionate, excited, thrilled, opportunity, leverage, robust, journey, delve, landscape, reach out, hope this finds you well, I know I'm young, I know my age makes this unusual
- apologising for his age or experience. State the age once as a fact and move on.
- offering to work unpaid. Do not mention money at all.
- flattery about the company that could apply to any company.
- more than one question in the whole email.
- links, attachments, bullet lists, a P.S.

STYLE: short sentences, plain words, first person, sounds like a person typing quickly and carefully. Output the email body only, no subject line, no commentary.`;

  try {
    const model = isAiConfigured()
      ? openai("gpt-4o")
      : groq("llama-3.3-70b-versatile");

    const { text } = await generateText({ model, prompt });

    const cleaned = normalizeDraftPunctuation(normalizeDraftGreeting(text.trim()));

    return {
      subject: OUTREACH_SUBJECT,
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

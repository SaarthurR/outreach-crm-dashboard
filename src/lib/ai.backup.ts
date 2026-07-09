import { addDays } from "date-fns";
import { generateText, Output } from "ai";
import { groq } from "@ai-sdk/groq";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { buildDraftPersonalization } from "@/lib/draft-personalization";
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

export function normalizeDraftGreeting(body: string) {
  const normalizedBody = body.replace(/\r\n/g, "\n").trim();

  if (!normalizedBody) {
    return "Hey there,";
  }

  const lines = normalizedBody.split("\n");

  if (/^(?:hi|hello|hey|dear)\b/i.test(lines[0] ?? "")) {
    return lines.join("\n");
  }

  return ["Hey there,", "", normalizedBody].join("\n");
}

function normalizeDraftPunctuation(body: string) {
  return body.replace(/\s+(?:--|—|–)\s+/g, ", ");
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
  const contextLine = personalization.introLine ?? `I came across ${personalization.companyName} and wanted to reach out.`;

  return {
    body: joinDraftLines([
      `Hey there -\n\nI know this is a cold email and a bit unusual. I'm ${settings.fullName}, a 14-year-old from ${settings.city}. ${contextLine}`,
      "",
      "I've built and sold a gaming/proxy website system to around 20 customers and deployed a Vercel + Firebase-backed website under real traffic. I also develop trading tools using LLMs, TradingView PineScript, and the IBKR API.",
      "",
      personalization.offerLine,
      "",
      "I'd love to intern here. I'm fine with unpaid and happy to start with a small trial task.",
      "",
      "Would you be open to a quick chat?",
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
  const contextLine = personalization.introLine ?? `I came across ${personalization.companyName} and wanted to reach out.`;

  return {
    body: joinDraftLines([
      `Hey there -\n\nI know this is a cold email and a bit unusual. I'm ${settings.fullName}, a 14-year-old from ${settings.city}. ${contextLine}`,
      "",
      "Quick background: I built and sold a small gaming/proxy site at school with about 20 customers, and I spend a lot of time building with LLMs, mostly around trading and automation. Outside tech, I've played tabla for nine years, teach locally, and placed second nationally at Chaitradhun.",
      "",
      personalization.offerLine,
      "",
      "I'd love to intern here. I don't need anything formal — unpaid is completely fine, and I'm happy to start with a small trial task.",
      "",
      "Would you be open to a quick chat?",
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
    subject: "Internship Inquiry",
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

  const companyContext = [
    `Company: ${personalization.companyName}`,
    personalization.detail ? `What they do: ${personalization.detail}` : null,
    personalization.roleDetail ? `Open roles / team focus: ${personalization.roleDetail}` : null,
    lead.contactName ? `Contact name: ${lead.contactName}` : null,
    `How found: ${lead.source}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const accomplishments = settings.accomplishments.slice(0, 4).join("\n- ");

  const firstName = settings.firstName || settings.fullName;
  const contactFirst = lead.contactName ? lead.contactName.split(" ")[0] : null;
  const greeting = contactFirst ? `Hi ${contactFirst} -` : "Hey there -";

  const prompt = `Write a cold outreach email from ${settings.fullName}, a 14-year-old from ${settings.city}, looking for a summer internship. First person only (I/my/me). Under 150 words.

SENDER BACKGROUND — use the actual specifics, never water them down:
- ${accomplishments}
- Fine with unpaid; parents supportive; remote preferred
- Tone: ${settings.tone}

COMPANY:
${companyContext}

STRUCTURE — write exactly these paragraphs, each separated by a blank line:

Paragraph 1: "${greeting}"

Paragraph 2: Acknowledge this is a cold email and unusual. Introduce yourself by name and age (14) and city. In 1–2 sentences, mention something specific about what this company does as the natural reason you're writing — not as a compliment, just as context.

Paragraph 3: Quick background — 1–2 sentences using the real specifics (20 customers, IBKR API, Pine Script, Vercel + Firebase — whichever fits this company best). No vague summaries.

Paragraph 4: What you could help with, tied to what this company actually does. Be specific to them, not generic.

Paragraph 5: Express genuine interest — something like "I'd love to have an internship here." Add that unpaid is fine and you're happy to start with a small trial task.

Paragraph 6: One simple closing question (e.g. "Would you be open to a quick chat?").

Paragraph 7: "Best,\\n${firstName}"

RULES:
- Simple words, short sentences — write like you talk
- No hollow phrases: "passionate about", "innovative", "excited about the opportunity", "demonstrate my abilities"
- No links, no attachments
- First person only
- Output the email body only — no subject line, no commentary`;


  try {
    const model = isAiConfigured()
      ? openai("gpt-4o")
      : groq("llama-3.3-70b-versatile");

    const { text } = await generateText({ model, prompt });

    const cleaned = normalizeDraftPunctuation(normalizeDraftGreeting(text.trim()));

    return {
      subject: "Internship Inquiry",
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

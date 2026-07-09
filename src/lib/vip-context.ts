/**
 * Curated context for high-profile companies where scraped data isn't enough.
 * Each entry gives GPT-4o accurate, specific hooks Saarth can authentically
 * connect to — products he actually uses, work he's followed, real overlap.
 *
 * Keyed by domain (matches lead.domain).
 */

export interface VipCompanyContext {
  /** Override what the company does — replaces scraped description */
  whatTheyDo: string;
  /** Specific products or projects Saarth has actually used or followed */
  saarthConnection: string;
  /** One or two things about their work he finds genuinely interesting */
  specificInterest: string;
}

const VIP_CONTEXT: Record<string, VipCompanyContext> = {
  "anthropic.com": {
    whatTheyDo:
      "Anthropic builds frontier AI systems with a focus on safety and reliability. Their main product is Claude — a family of models (Haiku, Sonnet, Opus) used for reasoning, coding, and complex tasks. They also ship Claude Code, a CLI-based coding agent.",
    saarthConnection:
      "Saarth has been using Claude Code daily to build this internship CRM — writing code, debugging, making architecture decisions with it. He also calls the Claude API (claude-sonnet-4-6) directly in several projects. He's not someone who's heard of Claude; he's a daily active user who's watched how the product has evolved.",
    specificInterest:
      "He's noticed the difference in how Sonnet vs Opus handle nuanced instruction-following in prompts. He's also interested in how Anthropic thinks about model behavior through Constitutional AI — specifically how you get a model to follow complex, sometimes contradictory rules without breaking.",
  },

  "openai.com": {
    whatTheyDo:
      "OpenAI builds frontier AI models and the infrastructure around them. GPT-4o is their current flagship — used through the API and through ChatGPT. They also run the developer platform that a huge portion of AI-powered products run on.",
    saarthConnection:
      "Saarth uses the GPT-4o API directly in this CRM — it's the model that generates every outreach email before it sends. He integrates it via the Vercel AI SDK with structured prompts and has spent time tuning prompt design to get consistent output. He also uses ChatGPT daily for ideation and debugging.",
    specificInterest:
      "He's spent time studying how GPT-4o responds to different instruction styles — numbered paragraphs vs free-form guidance, what makes the model follow rules vs ignore them. He's genuinely curious about how OpenAI approaches prompt adherence and why the model sometimes ignores explicit instructions.",
  },
};

export function getVipContext(domain: string): VipCompanyContext | null {
  const normalized = domain.replace(/^www\./, "").toLowerCase();
  return VIP_CONTEXT[normalized] ?? null;
}

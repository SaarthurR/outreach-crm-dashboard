function read(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export const env = {
  get nextAuthUrl() {
    return read("NEXTAUTH_URL");
  },
  get nextAuthSecret() {
    return read("NEXTAUTH_SECRET");
  },
  get authorizedGmailAddress() {
    return read("AUTHORIZED_GMAIL_ADDRESS");
  },
  get googleClientId() {
    return read("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return read("GOOGLE_CLIENT_SECRET");
  },
  get openAiApiKey() {
    return read("OPENAI_API_KEY");
  },
  get groqApiKey() {
    return read("GROQ_API_KEY");
  },
  get databaseUrl() {
    return read("DATABASE_URL") ?? "file:local.db";
  },
  /** Resume attached to every outgoing email. Defaults to assets/ in the repo. */
  get resumePath() {
    return read("RESUME_PATH");
  },
  get gmailPubsubTopic() {
    return read("GMAIL_PUBSUB_TOPIC");
  },
  get gmailWebhookSecret() {
    return read("GMAIL_WEBHOOK_SECRET");
  },
  get cronSecret() {
    return read("CRON_SECRET");
  },
};

export function isLiveGmailConfigured() {
  return Boolean(
    env.googleClientId &&
      env.googleClientSecret &&
      env.authorizedGmailAddress &&
      env.nextAuthSecret,
  );
}

export function isAiConfigured() {
  return Boolean(env.openAiApiKey);
}

export function isWebhookAuthorized(secret: string | null) {
  return Boolean(secret && env.gmailWebhookSecret && secret === env.gmailWebhookSecret);
}

export function isCronAuthorized(secret: string | null) {
  return Boolean(secret && env.cronSecret && secret === env.cronSecret);
}

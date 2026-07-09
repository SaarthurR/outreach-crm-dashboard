import { getServerSession, type NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";

import { saveIntegrationState } from "@/lib/db/repository";
import { env } from "@/lib/env";

const googleProvider =
  env.googleClientId && env.googleClientSecret
    ? Google({
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
        authorization: {
          params: {
            access_type: "offline",
            prompt: "consent",
            scope: [
              "openid",
              "email",
              "profile",
              "https://www.googleapis.com/auth/gmail.send",
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/gmail.modify",
            ].join(" "),
          },
        },
      })
    : null;

export const authOptions: NextAuthOptions | null = googleProvider
  ? {
      providers: [googleProvider],
      secret: env.nextAuthSecret,
      session: {
        strategy: "jwt",
      },
      callbacks: {
        async signIn({ profile }) {
          const email = profile?.email;

          if (!env.authorizedGmailAddress) {
            return false;
          }

          return email === env.authorizedGmailAddress;
        },
        async jwt({ token, account, profile }) {
          if (profile?.email) {
            token.email = profile.email;
          }

          if (account) {
            await saveIntegrationState({
              emailAddress: profile?.email ?? token.email ?? null,
              accessToken: account.access_token ?? null,
              refreshToken: account.refresh_token ?? null,
              expiryDate: account.expires_at ? account.expires_at * 1000 : null,
            });
          }

          return token;
        },
        async session({ session, token }) {
          if (session.user && token.email) {
            session.user.email = token.email;
          }

          return session;
        },
      },
    }
  : null;

export async function auth() {
  return authOptions ? getServerSession(authOptions) : null;
}

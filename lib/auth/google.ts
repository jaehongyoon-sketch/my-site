import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { cookieNames, cookieValue, readSession } from "./google-core";
export function googleConfig() {
  const values = env as unknown as Record<string, string | undefined>;
  const origin =
    values.APP_ORIGIN ??
    "https://event-market-day-one-jy.jaehong-yoon.chatgpt.site";
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw new Error("Invalid APP_ORIGIN");
  const clientId = values.GOOGLE_CLIENT_ID,
    clientSecret = values.GOOGLE_CLIENT_SECRET;
  return {
    origin,
    clientId,
    clientSecret,
    ready: Boolean(clientId && clientSecret),
    redirectUri: `${origin}/api/auth/google/callback`,
  };
}
export async function getGoogleUser() {
  const config = googleConfig();
  const token = cookieValue(
    (await headers()).get("cookie"),
    cookieNames(config.origin).session,
  );
  if (!token) return null;
  if (!env.DB) throw new Error("Account database unavailable");
  return readSession(env.DB, token);
}

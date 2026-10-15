import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const FLOW_SECONDS = 600;
export const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5000 },
);
export type GoogleIdentity = {
  userId: string;
  email: string;
  displayName: string;
};
export function randomToken() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
export async function hashToken(token: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
export function cookieNames(origin: string) {
  const prefix = new URL(origin).protocol === "https:" ? "__Host-" : "";
  return { session: `${prefix}event_session`, flow: `${prefix}event_oauth` };
}
export function cookieValue(raw: string | null, name: string) {
  const values = (raw ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function authCookie(
  name: string,
  value: string,
  seconds: number,
  origin: string,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(origin).protocol === "https:" ? "; Secure" : ""}`;
}
export async function verifyGoogleIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
    algorithms: ["RS256"],
    maxTokenAge: "2h",
    requiredClaims: ["sub", "exp", "iat", "nonce", "email", "email_verified"],
  });
  const claims = z
    .object({
      aud: z.literal(clientId),
      sub: z.string().min(1).max(255),
      nonce: z.literal(nonce),
      email: z.string().email(),
      email_verified: z.literal(true),
      name: z.string().optional(),
      azp: z.string().optional(),
    })
    .parse(payload);
  if (claims.azp && claims.azp !== clientId)
    throw new Error("Wrong authorized party");
  return {
    userId: claims.sub,
    email: claims.email,
    displayName: (claims.name ?? "").slice(0, 60),
  };
}
export async function consumeFlow(
  db: D1Database,
  state: string,
  browserToken: string,
  now = Date.now(),
) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(browserToken)
  )
    return null;
  return db
    .prepare(
      "DELETE FROM google_auth_flows WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING verifier, nonce",
    )
    .bind(await hashToken(state), await hashToken(browserToken), now)
    .first<{ verifier: string; nonce: string }>();
}
export async function readSession(
  db: D1Database,
  token: string,
  now = Date.now(),
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db
    .prepare(
      "SELECT google_subject AS userId, email, display_name AS displayName FROM google_sessions WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(await hashToken(token), now)
    .first<GoogleIdentity>();
}

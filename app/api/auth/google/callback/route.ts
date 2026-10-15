import { env } from "cloudflare:workers";
import { z } from "zod";
import { googleTokenRequest } from "@/lib/auth/token-request";
import { googleConfig } from "@/lib/auth/google";
import {
  authCookie,
  cookieNames,
  cookieValue,
  consumeFlow,
  hashToken,
  randomToken,
  verifyGoogleIdentity,
  SESSION_SECONDS,
} from "@/lib/auth/google-core";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const config = googleConfig(),
    names = cookieNames(config.origin);
  const responseHeaders = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": authCookie(names.flow, "", 0, config.origin),
  });
  let stage = "configuration";
  let failure = "callback_failed";
  try {
    if (!config.ready || !env.DB) throw new Error("Unavailable");
    const query = new URL(request.url).searchParams;
    const browser = cookieValue(request.headers.get("cookie"), names.flow);
    stage = "browser_state";
    if (!browser) { failure = "browser_cookie_missing"; throw new Error("Missing login cookie"); }
    if (query.getAll("state").length !== 1) { failure = "invalid_state"; throw new Error("Invalid state"); }
    stage = "consume_state";
    const flow = await consumeFlow(env.DB, query.get("state")!, browser);
    if (!flow) { failure = "login_expired"; throw new Error("Invalid or expired flow"); }
    if (query.has("error")) { failure = "google_declined"; throw new Error("Authorization declined"); }
    if (query.getAll("code").length !== 1) { failure = "invalid_code"; throw new Error("Invalid authorization"); }
    const code = query.get("code")!;
    if (!code || code.length > 4096) throw new Error("Invalid code");
    stage = "token_exchange";
    const response = await fetch("https://oauth2.googleapis.com/token", googleTokenRequest({
      clientId: config.clientId!,
      clientSecret: config.clientSecret!,
      code,
      verifier: flow.verifier,
      redirectUri: config.redirectUri,
    }));
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {error?:unknown}|null;
      failure = body?.error === "invalid_client" ? "client_configuration" : body?.error === "invalid_grant" ? "code_rejected" : "token_exchange_failed";
      throw new Error("Token exchange failed");
    }
    const tokens = z
      .object({ id_token: z.string().max(16000) })
      .parse(await response.json());
    stage = "verify_identity";
    const identity = await verifyGoogleIdentity(
      tokens.id_token,
      config.clientId!,
      flow.nonce,
    );
    const token = randomToken(),
      oldToken = cookieValue(request.headers.get("cookie"), names.session);
    stage = "save_session";
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM google_sessions WHERE expires_at <= ? OR token_hash = ?",
      ).bind(Date.now(), oldToken ? await hashToken(oldToken) : ""),
      env.DB.prepare(
        "INSERT INTO google_sessions (token_hash,google_subject,email,display_name,expires_at) VALUES (?,?,?,?,?)",
      ).bind(
        await hashToken(token),
        identity.userId,
        identity.email,
        identity.displayName,
        Date.now() + SESSION_SECONDS * 1000,
      ),
    ]);
    responseHeaders.append(
      "Set-Cookie",
      authCookie(names.session, token, SESSION_SECONDS, config.origin),
    );
    responseHeaders.set("Location", `${config.origin}/account`);
  } catch (error) {
    // Only fixed diagnostic labels; never log cookies, codes, tokens, email, or raw errors.
    const kind = error instanceof Error && ["TypeError", "JWTExpired", "JWTClaimValidationFailed", "JWSSignatureVerificationFailed", "JWKSTimeout", "ZodError", "AbortError", "TimeoutError"].includes(error.name) ? error.name : "Error";
    console.error("Google sign-in callback failed", { stage, failure, kind });
    responseHeaders.set("Location", `${config.origin}/account?auth=failed&reason=${failure}`);
  }
  return new Response(null, { status: 303, headers: responseHeaders });
}

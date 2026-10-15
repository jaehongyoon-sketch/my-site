import { env } from "cloudflare:workers";
import { googleConfig } from "@/lib/auth/google";
import {
  randomToken,
  hashToken,
  cookieNames,
  authCookie,
  FLOW_SECONDS,
} from "@/lib/auth/google-core";
export const dynamic = "force-dynamic";
export async function GET() {
  const config = googleConfig();
  if (!config.ready)
    return Response.redirect(`${config.origin}/account?auth=unavailable`, 303);
  try {
    if (!env.DB) throw new Error("DB unavailable");
    const state = randomToken(),
      browser = randomToken(),
      verifier = randomToken(),
      nonce = randomToken();
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM google_auth_flows WHERE expires_at <= ?",
      ).bind(Date.now()),
      env.DB.prepare(
        "INSERT INTO google_auth_flows (state_hash,browser_hash,verifier,nonce,expires_at) VALUES (?,?,?,?,?)",
      ).bind(
        await hashToken(state),
        await hashToken(browser),
        verifier,
        nonce,
        Date.now() + FLOW_SECONDS * 1000,
      ),
    ]);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId!,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: await hashToken(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.href,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": authCookie(
          cookieNames(config.origin).flow,
          browser,
          FLOW_SECONDS,
          config.origin,
        ),
      },
    });
  } catch {
    console.error("Google sign-in start failed");
    return Response.redirect(`${config.origin}/account?auth=failed`, 303);
  }
}

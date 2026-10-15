import { env } from "cloudflare:workers";
import { googleConfig } from "@/lib/auth/google";
import {
  authCookie,
  cookieNames,
  cookieValue,
  hashToken,
} from "@/lib/auth/google-core";
import { checkMutationOrigin } from "@/lib/accounts/service";
export async function POST(request: Request) {
  try {
    checkMutationOrigin(request);
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }
  const config = googleConfig(),
    names = cookieNames(config.origin);
  try {
    const token = cookieValue(request.headers.get("cookie"), names.session);
    if (token) {
      if (!env.DB) throw new Error("DB unavailable");
      await env.DB.prepare("DELETE FROM google_sessions WHERE token_hash = ?")
        .bind(await hashToken(token))
        .run();
    }
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": authCookie(names.session, "", 0, config.origin),
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Unable to sign out. Please retry." },
      { status: 503 },
    );
  }
}

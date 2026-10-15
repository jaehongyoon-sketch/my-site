import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccessError } from "@/lib/accounts/access";
import { reconcilePractice } from "@/lib/reconciliation/service";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in to check your practice records." },
        { status: 401, headers },
      );
    if (new URL(request.url).search)
      throw new AccessError(
        400,
        "This check uses your own account and full history; filters are not accepted.",
      );
    if (!env.DB) throw Error("Storage unavailable");
    return Response.json(await reconcilePractice(env.DB, identity), {
      headers,
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AccessError
            ? e.message
            : "Checks could not complete. No balance or records were changed.",
      },
      { status: e instanceof AccessError ? e.status : 503, headers },
    );
  }
}

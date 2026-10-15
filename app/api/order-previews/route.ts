import { boundedBody } from "@/lib/security/request-body";
import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccountError, checkMutationOrigin } from "@/lib/accounts/service";
import { previewOrder, OrderPreviewError } from "@/lib/orders/preview";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        {
          code: "SIGN_IN_REQUIRED",
          error: "Sign in with Google to review a limit buy.",
        },
        { status: 401, headers },
      );
    checkMutationOrigin(request);
    const raw = await boundedBody(request);
    if (raw.length > 2048)
      return Response.json(
        { code: "REQUEST_TOO_LARGE", error: "Request is too large." },
        { status: 413, headers },
      );
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return Response.json(
        { code: "INVALID_JSON", error: "Invalid order request." },
        { status: 400, headers },
      );
    }
    if (!env.DB) throw new Error("DB unavailable");
    return Response.json(await previewOrder(env.DB, identity, input), {
      headers,
    });
  } catch (e) {
    if (e instanceof OrderPreviewError)
      return Response.json(
        { code: e.code, error: e.message },
        { status: e.status, headers },
      );
    if (e instanceof AccountError)
      return Response.json({ error: e.message }, { status: e.status, headers });
    console.error("Order preview unavailable");
    return Response.json(
      {
        code: "PREVIEW_UNAVAILABLE",
        error:
          "Unable to review this request. No order was created. Please retry.",
      },
      { status: 503, headers },
    );
  }
}

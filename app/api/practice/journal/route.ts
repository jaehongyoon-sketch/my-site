import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccessError } from "@/lib/accounts/access";
import { cashJournal } from "@/lib/practice/journal";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in to view your practice activity." },
        { status: 401, headers },
      );
    if (!env.DB) throw Error("Storage unavailable");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys())
      if (!["page", "kind"].includes(key))
        throw new AccessError(400, "Unknown activity filter.");
    return Response.json(
      await cashJournal(env.DB, identity, {
        page: Number(params.get("page") ?? 0),
        kind: params.get("kind") ?? "all",
      }),
      { headers },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AccessError
            ? e.message
            : "Practice activity is temporarily unavailable.",
      },
      { status: e instanceof AccessError ? e.status : 503, headers },
    );
  }
}

import { env } from "cloudflare:workers";
import { getGoogleUser } from "@/lib/auth/google";
import { AccessError, getAdminAccounts } from "@/lib/accounts/access";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: Request) {
  try {
    const identity = await getGoogleUser();
    if (!identity)
      return Response.json(
        { error: "Sign in required." },
        { status: 401, headers },
      );
    if (!env.DB) throw new Error("DB unavailable");
    const id = (env as unknown as Record<string, string | undefined>)
      .ADMIN_ACCOUNT_ID;
    const raw = new URL(request.url).searchParams.get("page") ?? "0";
    if (!/^\d{1,3}$/.test(raw)) throw new AccessError(400, "Invalid page.");
    return Response.json(
      await getAdminAccounts(env.DB, identity, id, Number(raw)),
      { headers },
    );
  } catch (error) {
    if (error instanceof AccessError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    console.error("Admin accounts unavailable");
    return Response.json(
      { error: "Account list unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}

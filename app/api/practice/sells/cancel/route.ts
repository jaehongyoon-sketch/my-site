import { practiceRequest } from "@/lib/practice/http";
export const dynamic = "force-dynamic";
export const POST = (r: Request) => practiceRequest(r, "sell-cancel");

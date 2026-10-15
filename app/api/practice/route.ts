import { practiceRequest } from "@/lib/practice/http";
export const dynamic = "force-dynamic";
export const GET = (r: Request) => practiceRequest(r, "read");
export const POST = (r: Request) => practiceRequest(r, "start");

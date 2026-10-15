import { eligibilityRequest } from "@/lib/eligibility/http";
export const GET = (request: Request) => eligibilityRequest(request, "list");
export const POST = (request: Request) => eligibilityRequest(request, "change");

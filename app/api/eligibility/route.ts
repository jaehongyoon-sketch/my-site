import { eligibilityRequest } from "@/lib/eligibility/http";
export const GET = (request: Request) => eligibilityRequest(request, "self");

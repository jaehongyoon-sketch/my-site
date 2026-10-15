import { resolutionRequest } from "@/lib/resolutions/http";
export const GET = (request: Request) => resolutionRequest(request, "preview");

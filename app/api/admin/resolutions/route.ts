import { resolutionRequest } from "@/lib/resolutions/http";
export const GET = (request: Request) => resolutionRequest(request, "list");
export const POST = (request: Request) => resolutionRequest(request, "save");

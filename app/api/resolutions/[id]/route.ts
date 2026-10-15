import { resolutionRequest } from "@/lib/resolutions/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return resolutionRequest(request, "public", (await params).id);
}

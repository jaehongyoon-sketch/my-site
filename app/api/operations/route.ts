import { operationsRequest } from "@/lib/operations/http";
export const GET = (r: Request) => operationsRequest(r, true);

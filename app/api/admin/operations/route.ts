import { operationsRequest } from "@/lib/operations/http";
export const GET = (r: Request) => operationsRequest(r);
export const POST = (r: Request) => operationsRequest(r);

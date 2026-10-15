import { AccountError } from "../accounts/service";
// Enforce a byte cap while reading, before buffering the complete request.
export async function boundedBody(request: Request, maxBytes = 16384) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBytes)
    throw new AccountError(413, "Request is too large.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AccountError(413, "Request is too large.");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

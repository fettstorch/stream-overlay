import { joinByteChunks } from "../../../packages/overlay-sdk/src/bytes.ts";

export async function boundedBody(request: Request, maximum: number) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new RangeError("Body too large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new RangeError("Body too large");
    }
    chunks.push(value);
  }
  return joinByteChunks(chunks, length);
}

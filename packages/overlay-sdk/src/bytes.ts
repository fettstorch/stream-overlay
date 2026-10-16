/** Assemble already-bounded stream chunks without taking ownership of the reader. */
export function joinByteChunks(chunks: readonly Uint8Array[], length: number) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

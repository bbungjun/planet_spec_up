/** Decode only after reassembling bytes: HTTP chunks may split a Korean glyph. */
export async function readJsonBody(stream, limit = 4_000_000) {
  const chunks = []; let length = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.byteLength;
    if (length > limit) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Convert raw modulated Pronto (0000) words to a Broadlink IR hex packet. */
export function convertProntoCode(pronto: string): string {
  const words = pronto.trim().split(/\s+/);
  if (words.length < 6 || words.some(word => !/^[0-9a-f]{4}$/i.test(word))) throw new Error('Pronto requires four-digit hexadecimal words');
  const values = words.map(word => parseInt(word, 16));
  if (values[0] !== 0) throw new Error('Only raw modulated Pronto (0000) is supported');
  if (!values[1] || values.length !== 4 + 2 * (values[2] + values[3])) throw new Error('Invalid Pronto frequency or burst count');
  const durations: number[] = [];
  for (const cycles of values.slice(4)) {
    const microseconds = Math.round(cycles * values[1] * 0.241246);
    const ticks = Math.floor(microseconds * 269 / 8192);
    if (ticks < 1 || ticks > 65535) throw new Error('Pronto pulse is outside the Broadlink encoding range');
    if (ticks >= 256) durations.push(0, ticks >> 8, ticks & 0xff);
    else durations.push(ticks);
  }
  if (durations.length > 65535) throw new Error('Pronto code is too long');
  const header = Buffer.alloc(4);
  header[0] = 0x26;
  header.writeUInt16LE(durations.length, 2);
  const code = Buffer.concat([header, Buffer.from(durations), Buffer.from([0x0d, 0x05])]);
  // Preserve the legacy converter's alignment with the four-byte RM command.
  return Buffer.concat([code, Buffer.alloc((16 - (code.length + 4) % 16) % 16)]).toString('hex');
}

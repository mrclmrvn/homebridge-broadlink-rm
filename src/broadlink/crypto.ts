import * as crypto from 'crypto';

export function calculateChecksum(buf: Buffer, initial = 0xbeaf): number {
  let sum = initial;
  for (let i = 0; i < buf.length; i++) {
    sum = (sum + buf[i]) & 0xffff;
  }
  return sum;
}

export function encryptPayload(key: Buffer, iv: Buffer, payload: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  const padded = Buffer.alloc(Math.ceil(payload.length / 16) * 16);
  payload.copy(padded);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

export function decryptPayload(key: Buffer, iv: Buffer, encrypted: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function macStringToBuffer(mac: string): Buffer {
  const clean = mac.replace(/[:.\-]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(clean)) {
    throw new Error(`Invalid MAC address format: "${mac}". Expected 6 hexadecimal bytes.`);
  }
  return Buffer.from(clean, 'hex');
}

export function macBufferToString(mac: Buffer): string {
  if (mac.length !== 6) {
    throw new Error(`Invalid MAC buffer length: ${mac.length}. Expected 6 bytes.`);
  }
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':');
}


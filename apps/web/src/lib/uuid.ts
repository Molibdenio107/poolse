/**
 * A v4 UUID in the browser. `crypto.randomUUID` exists only in a secure context
 * (HTTPS or localhost), so on a phone reaching dev over http://192.168… it is
 * undefined and the page crashes. `crypto.getRandomValues` has no such limit.
 */
export function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

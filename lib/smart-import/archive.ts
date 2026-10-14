import { inflateRawSync } from "zlib";
import * as XLSX from "xlsx";
import type { Feature } from "./types";

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export function encryptedOffice(buffer: Buffer) {
  if (!buffer.subarray(0, 8).equals(OLE)) return false;
  const container = XLSX.CFB.read(buffer, { type: "buffer" });
  const paths = container.FullPaths as string[];
  if (paths.some(path => /\/(?:EncryptionInfo|EncryptedPackage)$/i.test(path))) return true;
  // BIFF FILEPASS is an encryption marker, not worksheet protection.
  const workbook = (container.FileIndex as { name: string; content?: Uint8Array }[]).find(entry => /^(?:Workbook|Book)$/i.test(entry.name));
  if (workbook?.content) {
    const bytes = Buffer.from(workbook.content);
    for (let pos = 0; pos + 4 <= bytes.length;) {
      if (bytes.readUInt16LE(pos) === 0x002f) return true;
      pos += 4 + bytes.readUInt16LE(pos + 2);
    }
  }
  return false;
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Validate actual expanded content, CRC and bounds before handing it to XLSX.
// Nothing is written to disk and no ZIP paths are executed or extracted.
export function inspectZip(buffer: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let pos = buffer.length - 22; pos >= Math.max(0, buffer.length - 65557); pos--) {
    if (buffer.readUInt32LE(pos) === 0x06054b50 && pos + 22 + buffer.readUInt16LE(pos + 20) === buffer.length) { end = pos; break; }
  }
  if (end < 0) throw new Error("Malformed workbook ZIP directory.");
  const entries = buffer.readUInt16LE(end + 10);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || entries !== buffer.readUInt16LE(end + 8) || entries === 0xffff || entries > 10000) throw new Error("Unsupported multipart/ZIP64 archive or too many entries.");
  let position = buffer.readUInt32LE(end + 16);
  const directoryEnd = position + buffer.readUInt32LE(end + 12);
  if (directoryEnd !== end) throw new Error("Malformed workbook ZIP directory bounds.");
  let total = 0;
  const files = new Map<string, Buffer>();
  for (let index = 0; index < entries; index++) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) throw new Error("Malformed workbook archive entry.");
    const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20), size = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const next = position + 46 + nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
    const local = buffer.readUInt32LE(position + 42);
    if (next > end || local + 30 > position || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("Malformed workbook archive offsets.");
    if (flags & 1) throw new Error("Encrypted ZIP entries require an authorized decrypted workbook.");
    if (![0, 8].includes(method)) throw new Error("Unsupported workbook ZIP compression.");
    total += size;
    if (size === 0xffffffff || total > 50 * 1024 * 1024) throw new Error("Workbook expands beyond the safe 50 MB inspection limit.");
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    if (files.has(name) || /(?:^|\/)\.\.(?:\/|$)|^[/\\]|\\/.test(name)) throw new Error("Unsafe or duplicate workbook archive path.");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.readUInt32LE(end + 16)) throw new Error("Malformed workbook compressed data bounds.");
    const input = buffer.subarray(start, start + compressed);
    const data = method === 0 ? input : inflateRawSync(input, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size || crc32(data) !== buffer.readUInt32LE(position + 16)) throw new Error("Workbook archive integrity check failed.");
    files.set(name, data);
    position = next;
  }
  if (position !== directoryEnd || !files.has("[Content_Types].xml") || !files.has("xl/workbook.xml")) throw new Error("File is not a supported Excel workbook archive.");
  return files;
}

export function featureInventory(paths: string[]): Feature[] {
  const groups: [string, RegExp][] = [
    ["Charts", /^xl\/charts\//], ["Images", /^xl\/media\//], ["Pivot definitions", /^xl\/pivot(?:Tables|Cache)\//],
    ["Macros", /vbaProject\.bin$/i], ["External connections", /^xl\/(?:externalLinks\/|connections\.xml$)/],
    ["Excel tables", /^xl\/tables\//], ["Drawings", /^xl\/drawings\//], ["Comments and notes", /(?:comments\d*\.xml|threadedComments\/)/i],
  ];
  const features: Feature[] = groups.map(([name, pattern]) => {
    const details = paths.filter(path => pattern.test(path));
    return { name, scope: name === "External connections" || name === "Macros" ? "SPECIAL_HANDLING" : "ARCHIVE_ONLY", count: details.length, details };
  });
  const recognized = /^(?:\[Content_Types\]\.xml|_rels\/|docProps\/|xl\/(?:workbook\.xml|_rels\/|worksheets\/|styles\.xml|sharedStrings\.xml|theme\/|metadata\.xml|calcChain\.xml))/;
  const unknown = paths.filter(path => !recognized.test(path) && !groups.some(([, pattern]) => pattern.test(path)) && !path.endsWith("/"));
  features.push({ name: "Other workbook parts", scope: "ARCHIVE_ONLY", count: unknown.length, details: unknown });
  return features.filter(feature => feature.count > 0);
}

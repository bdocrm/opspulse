import * as XLSX from "xlsx";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
export type EncryptionInfo = { encrypted: boolean; supported: boolean; kind: "NONE" | "AGILE" | "STANDARD" | "LEGACY_XLS" | "UNKNOWN"; reason?: string };
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export function inspectEncryption(buffer: Buffer): EncryptionInfo {
  if (!buffer.subarray(0, 8).equals(OLE)) return { encrypted: false, supported: true, kind: "NONE" };
  const container = XLSX.CFB.read(buffer, { type: "buffer" });
  const entries = container.FileIndex as { name: string; content: Uint8Array }[];
  const info = entries.find(entry => entry.name === "EncryptionInfo");
  const pkg = entries.find(entry => entry.name === "EncryptedPackage");
  if (info || pkg) {
    if (!info || !pkg || info.content.length < 8 || pkg.content.length < 9) throw new Error("Corrupted encrypted workbook container.");
    const header = Buffer.from(info.content), data = Buffer.from(pkg.content);
    const size = data.readBigUInt64LE(0);
    if (size < 1n || size > BigInt(MAX_FILE_SIZE) || size > BigInt(data.length - 8)) throw new Error("Encrypted workbook payload exceeds supported bounds or is corrupted.");
    const unsupported = (kind: EncryptionInfo["kind"] = "UNKNOWN"): EncryptionInfo => ({ encrypted: true, supported: false, kind, reason: "This workbook encryption profile is unsupported. Ask the workbook owner for a supported XLSX copy." });
    const major = header.readUInt16LE(0), minor = header.readUInt16LE(2);
    if (major === 4 && minor === 4) {
      if (header.length > 65536 || header.readUInt32LE(4) !== 0x40) return unsupported("AGILE");
      const xml = header.subarray(8).toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsafe workbook encryption metadata.");
      const keys = [...xml.matchAll(/<p:encryptedKey\b[^>]*>/g)];
      const keyData = xml.match(/<keyData\b[^>]*>/)?.[0];
      if (keys.length !== 1 || !keyData || !/<dataIntegrity\b/.test(xml)) return unsupported("AGILE");
      for (const tag of [keyData, keys[0][0]]) {
        const attributes = Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
        if (attributes.cipherAlgorithm !== "AES" || attributes.cipherChaining !== "ChainingModeCBC" || ![128, 256].includes(Number(attributes.keyBits)) || Number(attributes.blockSize) !== 16 || Number(attributes.saltSize) !== 16 || !["SHA1", "SHA256", "SHA384", "SHA512"].includes(attributes.hashAlgorithm)) return unsupported("AGILE");
        const hashSizes: Record<string, number> = { SHA1: 20, SHA256: 32, SHA384: 48, SHA512: 64 };
        if (Number(attributes.hashSize) !== hashSizes[attributes.hashAlgorithm] || !/^[A-Za-z0-9+/]+={0,2}$/.test(attributes.saltValue ?? "") || Buffer.from(attributes.saltValue, "base64").length !== 16) throw new Error("Corrupted workbook encryption metadata.");
        if (tag === keys[0][0]) for (const field of ["encryptedKeyValue", "encryptedVerifierHashInput", "encryptedVerifierHashValue"]) {
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(attributes[field] ?? "") || !Buffer.from(attributes[field], "base64").length || Buffer.from(attributes[field], "base64").length % 16 !== 0 || Buffer.from(attributes[field], "base64").length > 80) throw new Error("Corrupted workbook password verifier.");
        }
        if (attributes.spinCount != null && (!/^\d+$/.test(attributes.spinCount) || Number(attributes.spinCount) > 200000)) return unsupported("AGILE");
      }
      return { encrypted: true, supported: true, kind: "AGILE" };
    }
    if ([2, 3, 4].includes(major) && minor === 2) {
      if (header.length < 44 || header.readUInt32LE(8) < 32 || header.readUInt32LE(8) > header.length - 12 || (header.readUInt32LE(4) & 0x3f) !== 0x24 || header.readUInt32LE(20) !== 0x660e || header.readUInt32LE(24) !== 0x8004 || header.readUInt32LE(28) !== 128) return unsupported("STANDARD");
      return { encrypted: true, supported: true, kind: "STANDARD" };
    }
    return unsupported();
  }
  const workbook = entries.find(entry => /^(Workbook|Book)$/.test(entry.name));
  if (!workbook) throw new Error("The OLE file is not a supported Excel workbook.");
  const bytes = Buffer.from(workbook.content);
  for (let pos = 0; pos + 4 <= bytes.length;) {
    const length = bytes.readUInt16LE(pos + 2);
    if (pos + 4 + length > bytes.length) throw new Error("Corrupted legacy workbook record.");
    if (bytes.readUInt16LE(pos) === 0x002f) return { encrypted: true, supported: false, kind: "LEGACY_XLS", reason: "Legacy XLS encryption is not enabled. Ask the workbook owner for an encrypted XLSX copy." };
    pos += 4 + length;
  }
  return { encrypted: false, supported: true, kind: "NONE" };
}

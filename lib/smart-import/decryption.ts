import { Worker } from "worker_threads";
import { join } from "path";
import { inspectEncryption } from "./encryption";
export type UnlockCode = "INVALID_PASSWORD" | "UNSUPPORTED_ENCRYPTION" | "CORRUPTED_WORKBOOK" | "PROCESSING_FAILED" | "PROCESSING_TIMEOUT" | "REQUEST_INTERRUPTED";
export class DecryptionError extends Error {
  constructor(public code: UnlockCode) { super(code); }
}
const workerSource = `
const {parentPort,workerData}=require('worker_threads');
const crypto=require('crypto'),path=require('path');
const office=require(workerData.modulePath),cfb=require('cfb');
parentPort.once('message',async input=>{
  let encrypted=Buffer.from(input.bytes),output,verified=false,password=input.password;
  input.password=undefined;
  try {
    // Verify Agile's password and authenticated package integrity before parsing.
    if(input.kind==='AGILE') {
      const agile=require(path.join(path.dirname(workerData.modulePath),'src/crypto/ecma376_agile.js'));
      const container=cfb.read(encrypted,{type:'buffer'});
      const info=Buffer.from(cfb.find(container,'EncryptionInfo').content);
      const pkg=Buffer.from(cfb.find(container,'EncryptedPackage').content);
      const meta=await agile.parseEncryptionInfo(info);
      if(!agile.verifyPassword(password,meta)) throw new Error('INVALID_PASSWORD');
      verified=true;
      const key=agile.convertPasswordToKey(password,meta.key.hashAlgorithm,meta.key.saltValue,meta.key.spinCount,meta.key.keyBits,Buffer.from('146e0be7abacd0d6','hex'));
      const packageKey=agile.crypt(false,meta.key.cipherAlgorithm,meta.key.cipherChaining,key,meta.key.saltValue,meta.key.encryptedKeyValue);
      const xml=info.subarray(8).toString('utf8');
      const integrity=xml.match(/<dataIntegrity\\b[^>]*>/)?.[0];
      const attrs=Object.fromEntries([...integrity.matchAll(/(\\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
      const hashSize=crypto.createHash(meta.package.hashAlgorithm.toLowerCase()).digest().length;
      const decryptHmac=(attribute,block)=>agile.crypt(false,meta.package.cipherAlgorithm,meta.package.cipherChaining,packageKey,agile.createIV(meta.package.hashAlgorithm,meta.package.saltValue,meta.package.blockSize,Buffer.from(block,'hex')),Buffer.from(attrs[attribute],'base64')).subarray(0,hashSize);
      const hmacKey=decryptHmac('encryptedHmacKey','5fb2ad010cb9e1f6');
      const hmacValue=decryptHmac('encryptedHmacValue','a0677f02b22c8433');
      const computed=crypto.createHmac(meta.package.hashAlgorithm.toLowerCase(),hmacKey).update(pkg).digest();
      if(hmacValue.length!==computed.length||!crypto.timingSafeEqual(hmacValue,computed))throw new Error('CORRUPTED_WORKBOOK');
      key.fill(0);packageKey.fill(0);hmacKey.fill(0);
    }
    output=await office.decrypt(encrypted,{password});
    password=undefined;
    parentPort.postMessage({ok:true,bytes:output});
  }catch(error){
    const code=error.message==='INVALID_PASSWORD'||(!verified&&/password is incorrect/i.test(error.message))?'INVALID_PASSWORD':'CORRUPTED_WORKBOOK';
    parentPort.postMessage({ok:false,code});
  }finally{password=undefined;encrypted.fill(0);if(output)output.fill(0);}
});`;

export function decryptWorkbook(buffer: Buffer, password: string, signal?: AbortSignal, timeoutMs = 15000): Promise<Buffer> {
  if (typeof password !== "string" || !password.trim() || password.length > 255) return Promise.reject(new DecryptionError("INVALID_PASSWORD"));
  const encryption = inspectEncryption(buffer);
  if (!encryption.encrypted || !encryption.supported) return Promise.reject(new DecryptionError("UNSUPPORTED_ENCRYPTION"));
  if (signal?.aborted) return Promise.reject(new DecryptionError("REQUEST_INTERRUPTED"));
  return new Promise((resolve, reject) => {
    // Direct dependency is traced into the runtime's root node_modules. Avoid
    // webpack's numeric require.resolve IDs and createRequire parser rewrites.
    const modulePath = join(process.cwd(), "node_modules", "officecrypto-tool", "index.js");
    const worker = new Worker(workerSource, { eval: true, workerData: { modulePath }, execArgv: [], stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    // Library exceptions and console output must never reach server logs.
    worker.stdout?.resume(); worker.stderr?.resume();
    let done = false;
    const finish = (error?: DecryptionError, output?: Buffer) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error); else resolve(output!);
    };
    const abort = () => finish(new DecryptionError("REQUEST_INTERRUPTED"));
    const timer = setTimeout(() => finish(new DecryptionError("PROCESSING_TIMEOUT")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("error", () => finish(new DecryptionError("PROCESSING_FAILED")));
    worker.once("exit", () => { if (!done) finish(new DecryptionError("PROCESSING_FAILED")); });
    worker.once("message", message => message.ok ? finish(undefined, Buffer.from(message.bytes)) : finish(new DecryptionError(message.code)));
    worker.postMessage({ bytes: buffer, password, kind: encryption.kind });
    password = "";
  });
}

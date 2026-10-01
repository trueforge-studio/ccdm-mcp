// Firma de request Portal Único, replicando el interceptor del frontend.
//
// signature = hybridEncrypt(`${valueToSign}|${nonce}|${timestamp}`)
//
// hybridEncrypt: AES-256-CBC (clave e IV aleatorios, PKCS#7) para el texto,
// y RSA-OAEP-SHA256 para cifrar la clave AES. Salida:
//   base64(RSA(aesKey)) : base64(iv) : base64(aesCiphertext)
//
// El esquema HMAC-SHA256 anterior es legacy y NO se usa aquí.

import { constants, createCipheriv, publicEncrypt, randomBytes, randomUUID } from "node:crypto";

export const DEFAULT_API_KEY = "5D8C1A90-7BAE-4041-A6A6-08DCE702AD38";

const PUBLIC_KEY_B64 =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAraQCAhnWWzV9JwlXeO3GoIH+OxslGRjq3DRKJmaiOkrhvJDEcxSSMVq7H7pKF+/V5oNAoiI4VyuZ4jG6E/NE+t8IXnvdX288BcV6NYI/0xdAZeookrNcTTMzHgn0VYE63067rhH4z/8q1JNs7EryXCMMPulF/0BqX8tERTQOGEjpv2zY6PwGrOwNx96gs5Jo5j4T8OsCsTP1Yp9SYSiLgL8gdwADuVsugdpxhh1gBuv2oAlLIK/OonuhJYTg7dBurmHRyIrgU9A9wbG0adlN3qsULWCIMjBwteJEFam6fn483SGq2NsHGcz/vpH7xc2OjQ1ZOCm4Y777VmhDbvqjyQIDAQAB";

export const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY_B64}\n-----END PUBLIC KEY-----`;

function normalizePem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

/** Cifrado híbrido RSA-OAEP-SHA256 + AES-256-CBC. Salida "rsaKey:iv:ciphertext" en base64. */
export function hybridEncryptText(plaintext: string, publicKey: string = DEFAULT_PUBLIC_KEY): string {
  const aesKey = randomBytes(32);
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
  const encryptedPayload = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  const encryptedKey = publicEncrypt(
    { key: normalizePem(publicKey), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey,
  );

  return [encryptedKey.toString("base64"), iv.toString("base64"), encryptedPayload.toString("base64")].join(":");
}

export interface SignTarget {
  method: string;
  url: URL;
  /** Body ya serializable (objeto) si es POST. */
  body?: unknown;
}

/**
 * Determina valueToSign como el interceptor:
 * 1. body presente -> JSON.stringify(body)
 * 2. si no, hay query -> query string
 * 3. si no, pathname
 * Casos especiales de api-angular incluidos.
 */
export function valueToSign(t: SignTarget): string {
  if (t.body !== undefined && t.body !== null) return JSON.stringify(t.body);

  let path = t.url.pathname;
  // Caso especial: /api-angular/consultas-iniciales se firma como /api/comun/consultas-iniciales
  if (path.startsWith("/api-angular/consultas-iniciales")) return "/api/comun/consultas-iniciales";
  // Caso especial: /api-angular/sitemap/update firma su pathname tal cual
  if (path === "/api-angular/sitemap/update") return path;

  const query = t.url.search.replace(/^\?/, "");
  if (query) return query;
  return path;
}

export interface Signature {
  apikey: string;
  nonce: string;
  timestamp: number;
  signature: string;
  plaintext: string;
}

export interface SignOptions {
  apiKey?: string;
  publicKey?: string;
  nonce?: string;
  timestamp?: number;
}

/** Genera nonce, timestamp y la firma híbrida para un request. */
export function signRequest(t: SignTarget, opts: SignOptions = {}): Signature {
  const nonce = opts.nonce ?? randomUUID();
  const timestamp = opts.timestamp ?? Date.now();
  const plaintext = `${valueToSign(t)}|${nonce}|${timestamp}`;
  return {
    apikey: opts.apiKey ?? DEFAULT_API_KEY,
    nonce,
    timestamp,
    signature: hybridEncryptText(plaintext, opts.publicKey),
    plaintext,
  };
}

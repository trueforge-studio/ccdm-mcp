import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PUBLIC_KEY, hybridEncryptText, signRequest, valueToSign } from "../src/signature.ts";

function parts(sig: string) {
  const p = sig.split(":");
  return { count: p.length, rsa: Buffer.from(p[0], "base64"), iv: Buffer.from(p[1], "base64"), ct: Buffer.from(p[2], "base64") };
}

test("la firma tiene 3 componentes base64 con tamaños correctos", () => {
  const sig = hybridEncryptText("hola|nonce|123");
  const p = parts(sig);
  assert.equal(p.count, 3);
  assert.equal(p.rsa.length, 256, "RSA-2048 -> 256 bytes");
  assert.equal(p.iv.length, 16, "IV de 16 bytes");
  assert.ok(p.ct.length > 0 && p.ct.length % 16 === 0, "ciphertext múltiplo de bloque AES");
});

test("usa base64 estándar, no base64url", () => {
  // Fuerza suficientes cifrados para ver +/ en la salida RSA.
  const chars = new Set<string>();
  for (let i = 0; i < 20; i++) for (const c of hybridEncryptText("x")) chars.add(c);
  assert.ok(![..."-_"].some((c) => chars.has(c)), "no debe contener - ni _");
});

test("cada firma es distinta (claves/IV aleatorios)", () => {
  assert.notEqual(hybridEncryptText("mismo texto"), hybridEncryptText("mismo texto"));
});

test("la clave pública embebida es un RSA-2048 válido", () => {
  const sig = hybridEncryptText("x", DEFAULT_PUBLIC_KEY);
  assert.equal(parts(sig).rsa.length, 256);
});

test("valueToSign: body -> JSON.stringify(body)", () => {
  const body = { especialidadId: 404, fecha: "01/10/2026" };
  const v = valueToSign({ method: "POST", url: new URL("https://x/api/foo"), body });
  assert.equal(v, JSON.stringify(body));
});

test("valueToSign: sin body con query -> query string", () => {
  const v = valueToSign({ method: "GET", url: new URL("https://x/api/foo?a=1&b=2") });
  assert.equal(v, "a=1&b=2");
});

test("valueToSign: sin body ni query -> pathname", () => {
  const v = valueToSign({ method: "GET", url: new URL("https://x/api/tenant/get-tenant") });
  assert.equal(v, "/api/tenant/get-tenant");
});

test("valueToSign: caso especial consultas-iniciales", () => {
  const v = valueToSign({ method: "GET", url: new URL("https://www.ccdm.cl/api-angular/consultas-iniciales/123") });
  assert.equal(v, "/api/comun/consultas-iniciales");
});

test("valueToSign: caso especial sitemap/update firma su pathname", () => {
  const v = valueToSign({ method: "POST", url: new URL("https://www.ccdm.cl/api-angular/sitemap/update") });
  assert.equal(v, "/api-angular/sitemap/update");
});

test("signRequest arma plaintext valueToSign|nonce|timestamp y respeta nonce/timestamp fijos", () => {
  const s = signRequest(
    { method: "POST", url: new URL("https://x/api/foo"), body: { a: 1 } },
    { nonce: "N", timestamp: 999 },
  );
  assert.equal(s.plaintext, `${JSON.stringify({ a: 1 })}|N|999`);
  assert.equal(s.nonce, "N");
  assert.equal(s.timestamp, 999);
  assert.equal(parts(s.signature).count, 3);
});

// Autenticación enchufable.
//
// La API de CCDM no usa cookies: cada request lleva headers x-portalunico-*
// (apikey, nonce, timestamp, signature) y algunos endpoints repiten
// nonce/timestamp/signature dentro del body. Este módulo NO genera firmas:
// el usuario entrega un AuthProvider propio (CCDM_AUTH_MODULE) o headers
// estáticos (CCDM_HEADERS).

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export interface AuthRequest {
  method: "GET" | "POST";
  url: URL;
  /** Body ya construido (antes de agregar bodyFields), si es POST. */
  body?: Record<string, unknown>;
  /** true si el endpoint lleva nonce/timestamp/signature en el body. */
  bodySigned: boolean;
}

export interface AuthResult {
  headers?: Record<string, string>;
  /** Campos que se mezclan en el body JSON (solo si bodySigned). */
  bodyFields?: Record<string, unknown>;
}

export type AuthProvider = (req: AuthRequest) => AuthResult | Promise<AuthResult>;

import { DEFAULT_API_KEY, signRequest } from "./signature.ts";

export { DEFAULT_API_KEY };

/** Headers fijos desde CCDM_HEADERS (JSON) + apikey. */
export function staticHeadersProvider(extra: Record<string, string> = {}): AuthProvider {
  return () => ({
    headers: { "x-portalunico-apikey": DEFAULT_API_KEY, ...extra },
  });
}

/**
 * Provider oficial: firma cada request con el esquema híbrido del frontend.
 * Es el default cuando no se configura CCDM_AUTH_MODULE ni CCDM_HEADERS.
 */
export function signingProvider(opts: { apiKey?: string; publicKey?: string } = {}): AuthProvider {
  return (req) => {
    const sig = signRequest({ method: req.method, url: req.url, body: req.body }, opts);
    return {
      headers: {
        "x-portalunico-apikey": sig.apikey,
        "x-portalunico-nonce": sig.nonce,
        "x-portalunico-timestamp": String(sig.timestamp),
        "x-portalunico-signature": sig.signature,
      },
      // medicoSobrecupo/* repiten nonce/timestamp/signature en el body.
      bodyFields: req.bodySigned ? { nonce: sig.nonce, timestamp: sig.timestamp, signature: sig.signature } : undefined,
    };
  };
}

/**
 * Carga el provider configurado:
 * - CCDM_AUTH_MODULE: ruta a un módulo .js/.ts cuyo `default` es un AuthProvider.
 * - CCDM_HEADERS: JSON con headers fijos (ej. copiados del navegador).
 */
export async function loadAuthProvider(env = process.env): Promise<AuthProvider> {
  if (env.CCDM_AUTH_MODULE) {
    const mod = await import(pathToFileURL(resolve(env.CCDM_AUTH_MODULE)).href);
    if (typeof mod.default !== "function") {
      throw new Error(`CCDM_AUTH_MODULE (${env.CCDM_AUTH_MODULE}) debe exportar por defecto un AuthProvider`);
    }
    return mod.default as AuthProvider;
  }
  if (env.CCDM_HEADERS) return staticHeadersProvider(JSON.parse(env.CCDM_HEADERS) as Record<string, string>);
  return signingProvider({ apiKey: env.CCDM_API_KEY, publicKey: env.CCDM_RSA_PUBLIC_KEY });
}

// Utilidades de fechas y búsqueda heurística en el catálogo de especialidades
// (la forma de consultas-iniciales aún no se conoce).

export type Json = unknown;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Recorre el JSON y entrega cada objeto plano encontrado. */
export function* walkObjects(node: Json): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const x of node) yield* walkObjects(x);
  } else if (node && typeof node === "object") {
    yield node as Record<string, unknown>;
    for (const v of Object.values(node)) yield* walkObjects(v);
  }
}

function pick(obj: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const re of patterns) {
    for (const [k, v] of Object.entries(obj)) {
      if (re.test(k) && v != null && v !== "" && typeof v !== "object") return v;
    }
  }
  return undefined;
}

// ---------- Fechas y horas ----------

const DMY = /^(\d{2})\/(\d{2})\/(\d{4})/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const HM = /(?:^|T|\s)(\d{2}):(\d{2})/;

/** "dd/MM/yyyy HH:mm" -> { fecha, hora } */
export function splitDateTime(v: string | null | undefined): { fecha: string; hora: string } | undefined {
  const fecha = normalizeDate(v);
  const hora = normalizeTime(v);
  return fecha && hora ? { fecha, hora } : undefined;
}

/** Normaliza "dd/MM/yyyy", "yyyy-MM-dd" o ISO a "dd/MM/yyyy". */
export function normalizeDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  let m = v.match(DMY);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  m = v.match(ISO);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return undefined;
}

export function normalizeTime(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(HM) ?? v.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/** "dd/MM/yyyy" + "HH:mm" -> clave ordenable "yyyyMMddHHmm". */
export function sortKey(fecha: string, hora = "00:00"): string {
  const [d, m, y] = fecha.split("/");
  return `${y}${m}${d}${hora.replace(":", "")}`;
}

// ---------- Especialidades ----------

export interface Specialty {
  id: number;
  nombre: string;
}

const ID_KEYS = [/^cod(igo)?especialidad$/i, /^especialidadid$/i, /^idespecialidad$/i, /^id$/i, /^cod(igo)?$/i];
const NAME_KEYS = [/^(nombre|descripcion|glosa)especialidad$/i, /^nombre$/i, /^descripcion$/i, /^glosa$/i, /nombre|descrip|glosa/i];

/** Busca especialidades en cualquier JSON (ej. consultas-iniciales) por texto. */
export function findSpecialties(data: Json, query: string): Specialty[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const seen = new Map<number, Specialty>();
  for (const obj of walkObjects(data)) {
    const id = Number(pick(obj, ID_KEYS));
    const nombre = pick(obj, NAME_KEYS);
    if (!Number.isFinite(id) || typeof nombre !== "string") continue;
    const n = norm(nombre);
    if (words.every((w) => n.includes(w)) && !seen.has(id)) seen.set(id, { id, nombre });
  }
  return [...seen.values()];
}

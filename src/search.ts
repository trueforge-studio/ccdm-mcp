// Búsqueda de alto nivel: "traumatología rodilla, cualquier sucursal, lo más cercano".

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ALL_SUCURSALES, type CcdmClient, type ProfesionalAgenda, toApiDate } from "./client.ts";
import { findSpecialties, sortKey, splitDateTime, type Specialty } from "./extract.ts";

let catalogCache: unknown;

/** Busca especialidades por nombre en el catálogo inicial (cacheado por proceso). */
export async function searchSpecialties(client: CcdmClient, query: string): Promise<Specialty[]> {
  catalogCache ??= await client.consultasIniciales();
  return findSpecialties(catalogCache, query);
}

/** Resuelve un id numérico o un nombre a una o más especialidades. */
export async function resolveSpecialties(client: CcdmClient, especialidad: string | number): Promise<Specialty[]> {
  if (typeof especialidad === "number" || /^\d+$/.test(especialidad)) {
    return [{ id: Number(especialidad), nombre: String(especialidad) }];
  }
  const found = await searchSpecialties(client, especialidad);
  if (!found.length) throw new Error(`No encontré especialidades que coincidan con "${especialidad}"`);
  return found;
}

export interface NearestQuery {
  especialidad: string | number;
  /** Fecha desde la que buscar (dd/MM/yyyy), por defecto hoy. */
  desde?: string;
  /** Solo horas en esta fecha (dd/MM/yyyy). */
  soloFecha?: string;
  /** Hora mínima/máxima HH:mm (inclusive). */
  horaDesde?: string;
  horaHasta?: string;
  sucursales?: number[];
  /** Cuántos días con disponibilidad revisar en detalle. */
  maxDias?: number;
  limite?: number;
  /**
   * Ventanas por día con tope de hora distinto, ej.
   * [{ fecha: "01/10/2026", horaHasta: "15:00" }, { fecha: "02/10/2026", horaHasta: "12:30" }].
   * Si se pasan, reemplazan a soloFecha/horaDesde/horaHasta: solo se consideran
   * esas fechas y un slot pasa si cae dentro de su ventana.
   */
  ventanas?: Ventana[];
}

export interface Ventana {
  /** dd/MM/yyyy */
  fecha: string;
  horaDesde?: string;
  horaHasta?: string;
}

export interface FoundSlot {
  fecha: string;
  hora: string;
  codProf: number;
  profesional: string;
  codSucursal: number;
  sucursal: string;
  codUnidad: number;
  unidad: string;
  correlativoAgenda: number;
  /** Código comercial buscado (ej. 404). */
  especialidadId: number;
  /** Prestación real del profesional (ej. 32701163 "Traumatologia rodilla"). */
  codPrestacion: number;
  especialidad: string;
}

function toSlot(p: ProfesionalAgenda, especialidadId: number): FoundSlot | undefined {
  const dt = splitDateTime(p.proxHoraDisponible);
  if (!dt || p.tieneProxHoraDisponible !== 1) return undefined;
  return {
    ...dt,
    codProf: p.codProf,
    profesional: [p.nombreProf, p.apePatProf, p.apeMatProf].map((x) => x?.trim()).filter(Boolean).join(" "),
    codSucursal: p.codSucursal,
    sucursal: p.desSucursal,
    codUnidad: p.codUnidad,
    unidad: p.desUnidad,
    correlativoAgenda: p.corregenda,
    especialidadId,
    codPrestacion: p.codEspecialidad,
    especialidad: p.desEspecialidad,
  };
}

export interface AvailableDay {
  especialidadId: number;
  especialidad: string;
  fecha: string;
  sucursales: number[];
  profesionales: string[];
}

export interface NearestResult {
  especialidades: Specialty[];
  slots: FoundSlot[];
  /** Días con disponibilidad según el calendario (un request por especialidad). */
  dias: AvailableDay[];
}

const splitCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export async function findNearestSlots(client: CcdmClient, q: NearestQuery): Promise<NearestResult> {
  const especialidades = await resolveSpecialties(client, q.especialidad);
  const sucursales = q.sucursales ?? ALL_SUCURSALES;
  const ventanas = q.ventanas;
  const fechasVentana = ventanas && new Set(ventanas.map((v) => v.fecha));
  const desde = q.desde
    ?? (ventanas ? [...ventanas.map((v) => v.fecha)].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0] : undefined)
    ?? q.soloFecha ?? toApiDate(new Date());
  const maxDias = q.maxDias ?? 3;
  const slots: FoundSlot[] = [];
  const dias: AvailableDay[] = [];

  for (const esp of especialidades) {
    const cal = await client.getSpecialtyCalendar({ especialidadId: esp.id, fecha: desde, sucursales });
    if (!cal || cal.codRespuesta !== 0) continue;

    let disponibles = (cal.disponibilidadDias ?? [])
      .filter((d) => d.codEstado === 1 && sortKey(d.dia) >= sortKey(desde))
      .sort((a, b) => sortKey(a.dia).localeCompare(sortKey(b.dia)));
    if (q.soloFecha) disponibles = disponibles.filter((d) => d.dia === q.soloFecha);
    if (fechasVentana) disponibles = disponibles.filter((d) => fechasVentana.has(d.dia));

    for (const d of disponibles) {
      dias.push({
        especialidadId: esp.id,
        especialidad: esp.nombre,
        fecha: d.dia,
        sucursales: [...new Set(d.empresaSucursal.flatMap((e) => splitCsv(e.codSucursal).map(Number)))],
        profesionales: [...new Set(d.empresaSucursal.flatMap((e) => splitCsv(e.codProf)))],
      });
    }

    // El detalle se pide con el mismo empresaSucursal del día, como hace el sitio.
    for (const d of disponibles.slice(0, maxDias)) {
      const det = await client.getSpecialtyDayDetail({
        especialidadId: esp.id, fecha: d.dia, sucursales, empresaSucursal: d.empresaSucursal,
      });
      for (const grupo of det?.agendasxEspComercial ?? []) {
        for (const p of grupo.profesionales ?? []) {
          const slot = toSlot(p, esp.id);
          if (slot && slot.fecha === d.dia) slots.push(slot);
        }
      }
    }
  }

  const pasaVentana = (s: FoundSlot) => {
    if (!ventanas) {
      return (!q.soloFecha || s.fecha === q.soloFecha)
        && (!q.horaDesde || s.hora >= q.horaDesde)
        && (!q.horaHasta || s.hora <= q.horaHasta);
    }
    const v = ventanas.find((w) => w.fecha === s.fecha);
    return !!v && (!v.horaDesde || s.hora >= v.horaDesde) && (!v.horaHasta || s.hora <= v.horaHasta);
  };

  const filtered = slots
    .filter(pasaVentana)
    .sort((a, b) => sortKey(a.fecha, a.hora).localeCompare(sortKey(b.fecha, b.hora)));

  return {
    especialidades,
    slots: filtered.slice(0, q.limite ?? 20),
    dias: dias.sort((a, b) => sortKey(a.fecha).localeCompare(sortKey(b.fecha))),
  };
}

// ---------- Vigilancia: detectar horas nuevas entre revisiones ----------

const STATE_FILE = process.env.CCDM_STATE_FILE ?? join(homedir(), ".ccdm", "watch-state.json");

const slotId = (s: FoundSlot) => `${s.especialidadId}|${s.fecha}|${s.hora}|${s.codProf}|${s.codSucursal}`;

async function loadState(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveState(state: Record<string, string[]>) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export interface CheckResult extends NearestResult {
  /** Horas que no estaban en la revisión anterior de esta misma búsqueda. */
  nuevas: FoundSlot[];
  /** Días que no estaban en la revisión anterior (señal fiable aunque el detalle falle). */
  nuevosDias: AvailableDay[];
  primeraRevision: boolean;
}

const dayId = (d: AvailableDay) => `${d.especialidadId}|${d.fecha}`;

/** Igual que findNearestSlots, pero recuerda lo visto y reporta solo lo nuevo. */
export async function checkForNewSlots(client: CcdmClient, q: NearestQuery): Promise<CheckResult> {
  const key = JSON.stringify(q);
  const result = await findNearestSlots(client, { ...q, limite: q.limite ?? 200 });
  const state = await loadState();
  const prevSlots = state[key];
  const prevDays = state[`${key}#dias`];
  const seenSlots = new Set(prevSlots ?? []);
  const seenDays = new Set(prevDays ?? []);
  state[key] = result.slots.map(slotId);
  state[`${key}#dias`] = result.dias.map(dayId);
  await saveState(state);
  const primeraRevision = !prevSlots && !prevDays;
  return {
    ...result,
    nuevas: primeraRevision ? [] : result.slots.filter((s) => !seenSlots.has(slotId(s))),
    nuevosDias: primeraRevision ? [] : result.dias.filter((d) => !seenDays.has(dayId(d))),
    primeraRevision,
  };
}

export function formatDay(d: AvailableDay): string {
  return `${d.fecha} · sucursales ${d.sucursales.join(",")} · prof ${d.profesionales.join(",")} · ${d.especialidad}`;
}

export function formatSlot(s: FoundSlot): string {
  return `${s.fecha} ${s.hora} · ${s.profesional} · ${s.sucursal} · ${s.especialidad}`;
}

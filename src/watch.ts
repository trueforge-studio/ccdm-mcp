#!/usr/bin/env node
// Vigila una especialidad y avisa (notificación de macOS) cuando se libera una hora.
//
//   node src/watch.ts 404 --hoy --hasta 15:00 --cada 120   (404 = Traumatología rodilla)
//   node src/watch.ts 404 --ventana hoy:-15:00 --ventana manana:-12:30   (hoy hasta 15:00, mañana hasta 12:30)
//
// Opciones:
//   --hoy              solo horas de hoy (hora mínima = ahora)
//   --fecha dd/MM/yyyy solo horas de esa fecha
//   --desde HH:mm      hora mínima (con --hoy, por defecto la hora actual)
//   --hasta HH:mm      hora máxima
//   --ventana F:D-H    ventana por día (repetible). F = hoy | manana | dd/MM/yyyy,
//                      D/H = hora desde/hasta (ambas opcionales). Ej: hoy:-15:00  manana:09:00-12:30
//   --sucursales 3,4   limitar sucursales
//   --cada N           segundos entre revisiones (mínimo 60, por defecto 120)
//   --una-vez          una sola revisión y salir

import { execFile } from "node:child_process";
import { parseArgs } from "node:util";
import { loadAuthProvider } from "./auth.ts";
import { CcdmClient, toApiDate } from "./client.ts";
import { checkForNewSlots, formatDay, formatSlot, type NearestQuery, type Ventana } from "./search.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hoy: { type: "boolean" },
    fecha: { type: "string" },
    desde: { type: "string" },
    hasta: { type: "string" },
    ventana: { type: "string", multiple: true },
    sucursales: { type: "string" },
    cada: { type: "string", default: "120" },
    "una-vez": { type: "boolean" },
  },
});

/** "hoy" | "manana" | "dd/MM/yyyy" -> dd/MM/yyyy */
function resolveFecha(f: string): string {
  const s = f.trim().toLowerCase();
  if (s === "hoy") return toApiDate(new Date());
  if (s === "manana" || s === "mañana") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toApiDate(d);
  }
  return f.trim();
}

/** "hoy:-15:00" | "manana:09:00-12:30" | "02/10/2026:-12:30" -> Ventana */
function parseVentana(spec: string): Ventana {
  const i = spec.lastIndexOf(":");
  // Separa "<fecha>:<rango>" cuidando que la fecha no tenga ":".
  const m = spec.match(/^([^:]+):(.*)$/);
  if (!m) return { fecha: resolveFecha(spec) };
  const [, fechaRaw, rango] = m;
  const [desde, hasta] = rango.split("-");
  return {
    fecha: resolveFecha(fechaRaw),
    horaDesde: desde?.trim() || undefined,
    horaHasta: hasta?.trim() || undefined,
  };
}

const especialidad = positionals.join(" ");
if (!especialidad) {
  console.error('Uso: node src/watch.ts "traumatologia rodilla" --hoy --hasta 15:00');
  process.exit(1);
}

const client = new CcdmClient({
  auth: await loadAuthProvider(),
  rut: process.env.CCDM_RUT,
  previsionId: process.env.CCDM_PREVISION_ID ? Number(process.env.CCDM_PREVISION_ID) : undefined,
});

const intervalMs = Math.max(60, Number(values.cada)) * 1000;
const nowHHmm = () => new Date().toTimeString().slice(0, 5);

function notify(title: string, message: string) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}" sound name "Glass"`], () => {});
}

const ventanas: Ventana[] | undefined = values.ventana?.length
  ? values.ventana.map(parseVentana)
  : undefined;

async function tick() {
  const hoy = toApiDate(new Date());
  // La hora mínima solo se autofija a "ahora" cuando la ventana es hoy.
  const conHoraActual = (v: Ventana): Ventana =>
    v.fecha === hoy && !v.horaDesde ? { ...v, horaDesde: nowHHmm() } : v;

  const q: NearestQuery = {
    especialidad,
    sucursales: values.sucursales?.split(",").map(Number),
    ...(ventanas
      ? { ventanas: ventanas.map(conHoraActual), maxDias: Math.max(3, ventanas.length) }
      : {
          soloFecha: values.fecha ?? (values.hoy ? hoy : undefined),
          horaDesde: values.desde ?? (values.hoy ? nowHHmm() : undefined),
          horaHasta: values.hasta,
        }),
  };
  const stamp = new Date().toLocaleTimeString("es-CL");
  try {
    const r = await checkForNewSlots(client, q);
    if (r.primeraRevision) {
      console.log(`[${stamp}] Línea base: ${r.dias.length} días, ${r.slots.length} horas (${r.especialidades.map((e) => e.nombre).join(", ")})`);
      r.dias.slice(0, 3).forEach((d) => console.log("   ", formatDay(d)));
      r.slots.slice(0, 5).forEach((s) => console.log("   ", formatSlot(s)));
    } else if (r.nuevas.length || r.nuevosDias.length) {
      const lines = [...r.nuevas.map(formatSlot), ...r.nuevosDias.map((d) => `día nuevo: ${formatDay(d)}`)];
      console.log(`[${stamp}] ¡Novedades!`);
      lines.forEach((l) => console.log("  →", l));
      notify("CCDM: hora disponible", lines.slice(0, 3).join("\n"));
    } else {
      const next = r.slots[0] ? formatSlot(r.slots[0]) : r.dias[0] ? formatDay(r.dias[0]) : "—";
      console.log(`[${stamp}] Sin novedades. Más cercano: ${next}`);
    }
  } catch (err) {
    console.error(`[${stamp}] Error:`, err instanceof Error ? err.message : err);
  }
}

await tick();
if (!values["una-vez"]) setInterval(tick, intervalMs);

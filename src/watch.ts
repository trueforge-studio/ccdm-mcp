#!/usr/bin/env node
// Vigila una especialidad y avisa (notificación de macOS) cuando se libera una hora.
//
//   node src/watch.ts 404 --hoy --hasta 15:00 --cada 120   (404 = Traumatología rodilla)
//
// Opciones:
//   --hoy              solo horas de hoy
//   --fecha dd/MM/yyyy solo horas de esa fecha
//   --desde HH:mm      hora mínima (con --hoy, por defecto la hora actual)
//   --hasta HH:mm      hora máxima
//   --sucursales 3,4   limitar sucursales
//   --cada N           segundos entre revisiones (mínimo 60, por defecto 120)
//   --una-vez          una sola revisión y salir

import { execFile } from "node:child_process";
import { parseArgs } from "node:util";
import { loadAuthProvider } from "./auth.ts";
import { CcdmClient, toApiDate } from "./client.ts";
import { checkForNewSlots, formatDay, formatSlot, type NearestQuery } from "./search.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hoy: { type: "boolean" },
    fecha: { type: "string" },
    desde: { type: "string" },
    hasta: { type: "string" },
    sucursales: { type: "string" },
    cada: { type: "string", default: "120" },
    "una-vez": { type: "boolean" },
  },
});

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

async function tick() {
  const q: NearestQuery = {
    especialidad,
    soloFecha: values.fecha ?? (values.hoy ? toApiDate(new Date()) : undefined),
    horaDesde: values.desde ?? (values.hoy ? nowHHmm() : undefined),
    horaHasta: values.hasta,
    sucursales: values.sucursales?.split(",").map(Number),
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

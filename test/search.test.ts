import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CCDM_STATE_FILE = join(tmpdir(), `ccdm-test-${process.pid}.json`);
const { CcdmClient } = await import("../src/client.ts");
const { findNearestSlots, checkForNewSlots } = await import("../src/search.ts");

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const calendar = fixture("calendarios-especialidad-reintento-oferta");
const dayDetail = fixture("calendarios-detalle-especialidad");

/** Detalle del día pedido: el fixture del 06/10 movido a esa fecha. */
function detailFor(fecha: string) {
  const d = structuredClone(dayDetail);
  d.diaCalendario = fecha;
  for (const p of d.agendasxEspComercial[0].profesionales) p.proxHoraDisponible = p.proxHoraDisponible.replace("06/10/2026", fecha);
  return d;
}

function fakeClient(cal: unknown, detailBodies: unknown[] = []) {
  const fetch = (async (u: URL, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname.endsWith("reintento-oferta")) return Response.json(cal);
    if (u.pathname.endsWith("detalle-especialidad")) {
      detailBodies.push(body);
      return Response.json(detailFor(body.fecha));
    }
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return new CcdmClient({ auth: () => ({}), rut: "11111111-1", fetch });
}

test("lee disponibilidadDias y pasa el empresaSucursal del día al detalle", async () => {
  const bodies: any[] = [];
  const r = await findNearestSlots(fakeClient(calendar, bodies), { especialidad: 404, desde: "01/10/2026", maxDias: 2 });
  assert.deepEqual(r.dias.map((d) => d.fecha).slice(0, 3), ["05/10/2026", "06/10/2026", "07/10/2026"]);
  assert.deepEqual(r.dias[0].sucursales, [3, 4]);
  assert.deepEqual(r.dias[0].profesionales, ["14", "356", "5339", "63"]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].fecha, "05/10/2026");
  assert.deepEqual(bodies[0].empresaSucursal, [{ codEmpresa: 5, codSucursal: "3,4", codProf: "14,356,5339,63" }]);
  assert.deepEqual(r.slots.slice(0, 2).map((s) => [s.fecha, s.hora, s.profesional, s.sucursal, s.correlativoAgenda]), [
    ["05/10/2026", "09:40", "Cristian Godoy Barrios", "Centro Médico Libertad", 2875],
    ["05/10/2026", "10:00", "Harold Reid Salas", "Centro Médico Bosques", 3061],
  ]);
});

test("soloFecha sin disponibilidad no pide detalle", async () => {
  const bodies: any[] = [];
  const r = await findNearestSlots(fakeClient(calendar, bodies), { especialidad: 404, soloFecha: "01/10/2026" });
  assert.equal(r.dias.length, 0);
  assert.equal(bodies.length, 0);
});

test("detecta un día que se libera entre revisiones", async () => {
  rmSync(process.env.CCDM_STATE_FILE!, { force: true });
  const q = { especialidad: 404, soloFecha: "01/10/2026" };
  assert.equal((await checkForNewSlots(fakeClient(calendar), q)).primeraRevision, true);
  assert.equal((await checkForNewSlots(fakeClient(calendar), q)).nuevosDias.length, 0);
  const liberada = structuredClone(calendar);
  liberada.disponibilidadDias.unshift({ dia: "01/10/2026", codEstado: 1, descEstado: "DISPONIBLE",
    empresaSucursal: [{ codEmpresa: 5, codSucursal: "4", codProf: "5339" }] });
  const r = await checkForNewSlots(fakeClient(liberada), q);
  assert.deepEqual(r.nuevosDias.map((d) => d.fecha), ["01/10/2026"]);
  assert.deepEqual(r.nuevas.map((s) => s.hora), ["09:40", "10:00"]);

  const conTope = await findNearestSlots(fakeClient(liberada), { ...q, horaHasta: "09:59" });
  assert.deepEqual(conTope.slots.map((s) => s.profesional), ["Cristian Godoy Barrios"]);
  rmSync(process.env.CCDM_STATE_FILE!, { force: true });
});

#!/usr/bin/env node
// Servidor MCP (stdio) sobre CcdmClient.
//
// Variables de entorno:
//   CCDM_RUT           RUT del paciente, ej. 12345678-9
//   CCDM_PREVISION_ID  previsión (opcional)
//   CCDM_AUTH_MODULE   módulo que exporta un AuthProvider (ver src/auth.ts)
//   CCDM_HEADERS       alternativa: JSON con headers fijos

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadAuthProvider } from "./auth.ts";
import { CcdmClient, toApiDate } from "./client.ts";
import { checkForNewSlots, findNearestSlots, formatDay, formatSlot, searchSpecialties } from "./search.ts";

const client = new CcdmClient({
  auth: await loadAuthProvider(),
  rut: process.env.CCDM_RUT,
  previsionId: process.env.CCDM_PREVISION_ID ? Number(process.env.CCDM_PREVISION_ID) : undefined,
});

const server = new McpServer({ name: "ccdm", version: "0.1.0" });

const fecha = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).describe("Fecha dd/MM/yyyy");
const sucursales = z.array(z.number().int()).optional().describe("Códigos de sucursal; por defecto todas (2-6)");

async function run(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data ?? null, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text" as const, text: String(err instanceof Error ? err.message : err) }] };
  }
}

server.registerTool("ccdm_initial_data", {
  description: "Datos iniciales del sitio de reservas (catálogos: especialidades, sucursales, previsiones). Úsalo para encontrar el especialidadId.",
  inputSchema: {},
}, () => run(() => client.consultasIniciales()));

server.registerTool("ccdm_specialty_availability", {
  description: "Días y profesionales con horas disponibles para una especialidad, desde una fecha (por defecto hoy).",
  inputSchema: { especialidadId: z.number().int(), fecha: fecha.optional(), sucursales },
}, (a) => run(() => client.getSpecialtyCalendar({ ...a, fecha: a.fecha ?? toApiDate(new Date()) })));

server.registerTool("ccdm_specialty_day", {
  description: "Horas disponibles en un día para una especialidad, para los profesionales indicados.",
  inputSchema: {
    especialidadId: z.number().int(), fecha,
    profesionales: z.array(z.union([z.number(), z.string()])).optional().describe("codProf de cada profesional"),
    empresaSucursal: z.array(z.object({ codEmpresa: z.number(), codSucursal: z.string(), codProf: z.string() })).optional()
      .describe("Tal cual viene en disponibilidadDias[].empresaSucursal de ccdm_specialty_availability (preferido)"),
    sucursales,
  },
}, (a) => run(() => client.getSpecialtyDayDetail(a)));

server.registerTool("ccdm_professional_availability", {
  description: "Días disponibles de un profesional (requiere unidadCentroMedicoId y correlativoAgenda de la búsqueda por especialidad).",
  inputSchema: {
    codProf: z.union([z.number(), z.string()]), rutProf: z.string().optional(),
    especialidadId: z.number().int(), unidadCentroMedicoId: z.number().int(),
    correlativoAgenda: z.number().int(), fecha, sucursales,
  },
}, (a) => run(() => client.getProfessionalCalendar(a)));

server.registerTool("ccdm_professional_day", {
  description: "Horas de un profesional en un día concreto.",
  inputSchema: {
    codProf: z.union([z.number(), z.string()]), especialidadId: z.number().int(),
    unidadCentroMedicoId: z.number().int(), correlativoAgenda: z.number().int(), fecha,
    sucursales: z.array(z.number().int()),
    agendas: z.array(z.object({
      codSucursal: z.number().int(), codUnidadCM: z.string(), corrAgenda: z.string(), codEspecialidad: z.string(),
    })),
  },
}, (a) => run(() => client.getProfessionalDayDetail(a)));

server.registerTool("ccdm_restrictions", {
  description: "Restricciones de agenda para el paciente (edad, sexo, cobertura, etc.).",
  inputSchema: {
    especialidadId: z.number().int(), sucursales, codProf: z.number().int().optional(),
    diaSeleccionado: z.string().optional(), idContexto: z.union([z.literal(1), z.literal(2)]).optional(),
  },
}, (a) => run(() => client.getRestrictions(a)));

server.registerTool("ccdm_overbook", {
  description: "Indica si existe sobrecupo para una especialidad o un profesional.",
  inputSchema: {
    especialidadId: z.number().int().optional(), codProf: z.union([z.number(), z.string()]).optional(),
    proximaFecha: fecha, sucursales,
  },
}, (a) => run(() => a.codProf != null
  ? client.hasOverbookProfessional({ codProf: a.codProf, proximaFecha: a.proximaFecha, sucursales: a.sucursales })
  : client.hasOverbookSpecialty({ especialidadId: a.especialidadId!, proximaFecha: a.proximaFecha, sucursales: a.sucursales })));

server.registerTool("ccdm_location", {
  description: "Datos de una sucursal y, opcionalmente, de su centro médico.",
  inputSchema: { codSucursal: z.number().int(), codCentro: z.number().int().optional() },
}, (a) => run(async () => ({
  sucursal: await client.getBranch(a.codSucursal),
  centro: a.codCentro != null ? await client.getMedicalCenter(a.codSucursal, a.codCentro) : undefined,
})));

// ---------- Alto nivel ----------

const hhmm = z.string().regex(/^\d{2}:\d{2}$/).describe("Hora HH:mm");
const nearestShape = {
  especialidad: z.union([z.string(), z.number()]).describe('Nombre (ej. "traumatologia rodilla") o especialidadId'),
  desde: fecha.optional().describe("Buscar desde esta fecha (por defecto hoy)"),
  soloFecha: fecha.optional().describe("Solo horas de esta fecha"),
  horaDesde: hhmm.optional(),
  horaHasta: hhmm.optional(),
  sucursales,
  maxDias: z.number().int().min(1).max(14).optional().describe("Días con disponibilidad a detallar (por defecto 3)"),
};

server.registerTool("ccdm_search_specialty", {
  description: "Busca especialidades por nombre en el catálogo (sin acentos, todas las palabras deben coincidir).",
  inputSchema: { query: z.string() },
}, (a) => run(() => searchSpecialties(client, a.query)));

server.registerTool("ccdm_nearest_slots", {
  description: "Horas más cercanas para una especialidad en todas las sucursales, ordenadas por fecha/hora. Ej: especialidad 'traumatologia rodilla', soloFecha hoy, horaHasta '15:00'.",
  inputSchema: { ...nearestShape, limite: z.number().int().optional() },
}, (a) => run(() => findNearestSlots(client, a)));

server.registerTool("ccdm_check_new_slots", {
  description: "Para usar en un loop: hace la misma búsqueda que ccdm_nearest_slots y devuelve en 'nuevas' las horas y en 'nuevosDias' los días que no estaban en la revisión anterior con los mismos parámetros. La primera llamada solo guarda la línea base.",
  inputSchema: nearestShape,
}, (a) => run(async () => {
  const r = await checkForNewSlots(client, a);
  return {
    primeraRevision: r.primeraRevision,
    nuevas: r.nuevas.map(formatSlot),
    nuevosDias: r.nuevosDias.map(formatDay),
    masCercanas: r.slots.slice(0, 5).map(formatSlot),
    totalHoras: r.slots.length,
    diasDisponibles: r.dias.slice(0, 5).map(formatDay),
  };
}));

await server.connect(new StdioServerTransport());

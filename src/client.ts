// Cliente para la API de agendamiento de Clínica Ciudad del Mar (CCDM),
// cliente del flujo "Reserva tu hora".

import type { AuthProvider } from "./auth.ts";

export const API_BASE = "https://apiprod-bsaye6h6a5hbhzgm.a03.azurefd.net/api";
export const WEB_BASE = "https://www.ccdm.cl";
export const EMPRESA_ID = 5;
/** Sucursales que el sitio envía al buscar en "Todas las sucursales". */
export const ALL_SUCURSALES = [6, 5, 4, 3, 2];

export interface ClientOptions {
  auth: AuthProvider;
  /** RUT del paciente con guion, ej. "12345678-9". */
  rut?: string;
  /** Previsión del paciente. */
  previsionId?: number;
  fetch?: typeof fetch;
}

export class CcdmApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, url: string) {
    super(`CCDM ${status} en ${url}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

// ---------- Fechas ----------

/** Date -> "dd/MM/yyyy" (formato que usa la API). */
export function toApiDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "dd/MM/yyyy" -> ISO a medianoche de Chile (UTC-3), como envía el sitio. */
export function apiDateToChileMidnightIso(fecha: string): string {
  const [dd, mm, yyyy] = fecha.split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd, 3)).toISOString();
}

// ---------- Body base de AgendamientoAmbulatorio ----------

function emptyPersona(): Record<string, unknown> {
  return {
    id: null, rut: null, digitoVerificador: null, tipoDeDocumentoId: null, rutCompleto: null,
    nombres: null, apellidoPaterno: null, apellidoMaterno: null, fechaNacimiento: null,
    email: null, prefijoCelular: null, numeroCelular: null, fono1: null, fono2: null,
    recibeInformacion: null, viaConfirmacionSms: null, previsionId: null, sexoId: null,
    comunaId: null, ciudadId: null, direccion: null, planId: null, tipoNacionalidad: null,
    nacionalidadId: null, estadoCivil: null,
  };
}

type Persona = Record<string, unknown>;

interface AgendaBodyOverrides extends Partial<Record<string, unknown>> {
  persona?: Partial<Persona>;
}

function agendaBody(overrides: AgendaBodyOverrides) {
  const { persona, ...rest } = overrides;
  return {
    empresaId: EMPRESA_ID, sucursalId: null, sucursalIds: [], unidadCentroMedicoId: null,
    areaInteres: null, especialidadId: null,
    persona: { ...emptyPersona(), ...persona },
    correlativoAgenda: null, fecha: null, hora: null, previsionId: null, canalId: null,
    tipoConsulta: null, tipoReserva: 1, correlativoReserva: null, tipoReservas: null,
    usuarioTransaccion: null, usuarioTransaccionExt: null, observacion: null,
    esModeloCentral: null, empresaSucursal: [], bloqueHorarioId: null, rut: null,
    modeloCentral: null, codProf: null, rutProf: null, agendasProfesional: null,
    ...rest,
  };
}

const csv = (xs: Array<number | string>) => xs.join(",");

// ---------- Parámetros ----------

export interface SpecialtyQuery {
  especialidadId: number;
  /** dd/MM/yyyy; por defecto hoy. */
  fecha?: string;
  sucursales?: number[];
  previsionId?: number;
  rut?: string;
}

export interface SpecialtyDayQuery extends SpecialtyQuery {
  fecha: string;
  /** Códigos de profesional a incluir (codProf). Ignorado si se pasa empresaSucursal. */
  profesionales?: Array<number | string>;
  /** Tal cual viene en disponibilidadDias[].empresaSucursal (lo que hace el sitio). */
  empresaSucursal?: EmpresaSucursal[];
}

// ---------- Respuestas ----------

/** Sucursales y profesionales como CSV, ej. { codSucursal: "3,4", codProf: "14,356" }. */
export interface EmpresaSucursal {
  codEmpresa: number;
  codSucursal: string;
  codProf: string;
}

export interface DisponibilidadDia {
  /** dd/MM/yyyy */
  dia: string;
  codEstado: number;
  descEstado: string;
  empresaSucursal: EmpresaSucursal[];
}

/** Respuesta de calendarios-especialidad-reintento-oferta. */
export interface SpecialtyCalendarResponse {
  codRespuesta: number;
  glosaRespuesta: string;
  /** Primer día con disponibilidad desde la fecha consultada. */
  diaInicioBusquedaHoras: string | null;
  codEspecialidad: number;
  modeloCentral: string;
  disponibilidadDias: DisponibilidadDia[];
  existenAlternativos: number;
  existenEnSucursales: number;
  listaProfAlternativo: unknown[];
  sucursalesAlternativos: unknown;
}

/** Profesional dentro de calendarios-detalle-especialidad. */
export interface ProfesionalAgenda {
  codProf: number;
  rutProf: number;
  dvProf: string;
  apePatProf: string;
  apeMatProf: string;
  nombreProf: string;
  /** Código de prestación real (ej. 32701163), distinto del codEspecialidad comercial (404). */
  codEspecialidad: number;
  desEspecialidad: string;
  /** Correlativo de agenda (el sitio lo envía como correlativoAgenda). */
  corregenda: number;
  fechaIniProxAgenda: string;
  /** "dd/MM/yyyy HH:mm": próxima hora en el día consultado. */
  proxHoraDisponible: string | null;
  /** "dd/MM/yyyy HH:mm": próxima hora real, puede ser anterior al día consultado. */
  proxHoraDisponibleReal: string | null;
  tieneProxHoraDisponible: number;
  codUnidad: number;
  desUnidad: string;
  codSucursal: number;
  desSucursal: string;
  mostrarAgenda: string;
  imagenProf: string;
  atiendeFonasa: number;
  atiendeOtraPrevision: number;
  nombreOtraPrevision: string;
  atiendeParticular: number;
  [k: string]: unknown;
}

/** Respuesta de calendarios-detalle-especialidad. */
export interface SpecialtyDayResponse {
  codRespuesta: number;
  glosaRespuesta: string;
  diaCalendario: string;
  codEspecialidad: number;
  modeloCentral: string;
  agendasxEspComercial: Array<{
    codSucursal: number | null;
    desSucursal: string | null;
    profesionales: ProfesionalAgenda[];
  }>;
}

export interface ProfessionalQuery {
  codProf: number | string;
  rutProf?: string;
  especialidadId: number;
  unidadCentroMedicoId: number;
  correlativoAgenda: number;
  fecha: string;
  sucursales?: number[];
  rut?: string;
}

export interface AgendaProfesional {
  codSucursal: number;
  codUnidadCM: string;
  corrAgenda: string;
  codEspecialidad: string;
}

export interface ProfessionalDayQuery {
  codProf: number | string;
  especialidadId: number;
  unidadCentroMedicoId: number;
  correlativoAgenda: number;
  fecha: string;
  sucursales: number[];
  agendas: AgendaProfesional[];
}

export interface RestrictionsQuery {
  especialidadId: number;
  sucursales?: number[];
  codProf?: number;
  /** dd/MM/yyyy o "" */
  diaSeleccionado?: string;
  /** 1 = por especialidad, 2 = por profesional. */
  idContexto?: 1 | 2;
  tipoEspecialidad?: number;
  rut?: string;
}

// ---------- Cliente ----------

export class CcdmClient {
  private auth: AuthProvider;
  private rut?: string;
  private previsionId?: number;
  private fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.auth = opts.auth;
    this.rut = opts.rut;
    this.previsionId = opts.previsionId;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private requireRut(rut?: string): string {
    const r = rut ?? this.rut;
    if (!r) throw new Error("Falta el RUT del paciente (CCDM_RUT o parámetro rut)");
    return r;
  }

  private async request<T>(
    method: "GET" | "POST",
    url: string,
    opts: { query?: Record<string, string | number>; body?: Record<string, unknown>; bodySigned?: boolean } = {},
  ): Promise<T | null> {
    const u = new URL(url);
    // La API espera fechas con "/" sin escapar, igual que el sitio.
    const qs = Object.entries(opts.query ?? {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%2F/g, "/")}`)
      .join("&");
    if (qs) u.search = qs;

    const bodySigned = opts.bodySigned ?? false;
    const auth = await this.auth({ method, url: u, body: opts.body, bodySigned });
    const body = opts.body && { ...opts.body, ...(bodySigned ? auth.bodyFields : {}) };

    const res = await this.fetchImpl(u, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: WEB_BASE,
        referer: `${WEB_BASE}/`,
        ...auth.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new CcdmApiError(res.status, text, u.toString());
    if (res.status === 204 || !text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  // --- Configuración / catálogos ---

  /** Datos iniciales del sitio (posiblemente especialidades, sucursales, previsiones). */
  consultasIniciales() {
    return this.request<unknown>("GET", `${WEB_BASE}/api-angular/consultas-iniciales/${Date.now()}`);
  }

  getTenant() {
    return this.request<unknown>("GET", `${API_BASE}/tenant/get-tenant`);
  }

  /** Textos de la UI: infoGesMenu, alertaCobertura, infoReservaHora, infoReservaHora2… */
  getMessages(messageCode: string, requestTypeStandarName = "InfoReservaHora") {
    return this.request<unknown>("GET", `${API_BASE}/requestTypeMessage/lista-mensaje-por-tipo`, {
      query: { messageCode, tenantCode: EMPRESA_ID, requestTypeStandarName },
    });
  }

  getBranch(code: number) {
    return this.request<unknown>("GET", `${API_BASE}/tenant/branch-por-code`, { query: { code } });
  }

  getMedicalCenter(codSucursal: number, codCentro: number) {
    return this.request<unknown>("GET", `${API_BASE}/Comun/centro-medico`, {
      query: { codEmpresa: EMPRESA_ID, codSucursal, codCentro },
    });
  }

  /** null (204) si la especialidad no redirige a otra. */
  getSpecialtyRedirect(codEspecialidadOrigen: number) {
    return this.request<unknown>("GET", `${API_BASE}/redireccionPorEspecialidad/redireccion-especialidad`, {
      query: { codEspecialidadOrigen },
    });
  }

  // --- Disponibilidad por especialidad ---

  /** Días con horas disponibles para una especialidad, con sucursales y profesionales por día. */
  getSpecialtyCalendar(q: SpecialtyQuery) {
    const sucursales = q.sucursales ?? ALL_SUCURSALES;
    return this.request<SpecialtyCalendarResponse>("POST", `${API_BASE}/AgendamientoAmbulatorio/calendarios-especialidad-reintento-oferta`, {
      body: agendaBody({
        areaInteres: 0,
        especialidadId: q.especialidadId,
        persona: { rutCompleto: this.requireRut(q.rut) },
        fecha: q.fecha ?? toApiDate(new Date()),
        previsionId: q.previsionId ?? this.previsionId ?? null,
        esModeloCentral: "S",
        empresaSucursal: [{ codEmpresa: EMPRESA_ID, codSucursal: csv(sucursales), codProf: null, codEspecialidad: null }],
      }),
    });
  }

  /** Horas de un día para una especialidad. Pasar el empresaSucursal del día, como hace el sitio. */
  getSpecialtyDayDetail(q: SpecialtyDayQuery) {
    const sucursales = q.sucursales ?? ALL_SUCURSALES;
    const empresaSucursal = q.empresaSucursal
      ?? [{ codEmpresa: EMPRESA_ID, codSucursal: csv(sucursales), codProf: csv(q.profesionales ?? []) }];
    return this.request<SpecialtyDayResponse>("POST", `${API_BASE}/AgendamientoAmbulatorio/calendarios-detalle-especialidad`, {
      body: agendaBody({
        especialidadId: q.especialidadId,
        persona: { rutCompleto: this.requireRut(q.rut) },
        fecha: q.fecha,
        hora: "00:00",
        previsionId: q.previsionId ?? this.previsionId ?? null,
        esModeloCentral: "S",
        empresaSucursal,
      }),
    });
  }

  // --- Disponibilidad por profesional ---

  /** Días disponibles de un profesional. */
  getProfessionalCalendar(q: ProfessionalQuery) {
    return this.request<unknown>("POST", `${API_BASE}/AgendamientoAmbulatorio/calendarios-especialista-ms`, {
      body: agendaBody({
        sucursalIds: q.sucursales ?? ALL_SUCURSALES,
        unidadCentroMedicoId: q.unidadCentroMedicoId,
        especialidadId: q.especialidadId,
        persona: { id: Number(q.codProf), rutCompleto: this.requireRut(q.rut) },
        correlativoAgenda: q.correlativoAgenda,
        fecha: q.fecha,
        esModeloCentral: "S",
        codProf: String(q.codProf),
        rutProf: q.rutProf ?? null,
      }),
    });
  }

  /** Horas de un profesional en un día concreto. */
  getProfessionalDayDetail(q: ProfessionalDayQuery) {
    return this.request<unknown>("POST", `${API_BASE}/AgendamientoAmbulatorio/calendarios-detalle-especialista-ms`, {
      body: agendaBody({
        sucursalIds: q.sucursales,
        unidadCentroMedicoId: q.unidadCentroMedicoId,
        especialidadId: q.especialidadId,
        persona: { id: Number(q.codProf) },
        correlativoAgenda: q.correlativoAgenda,
        fecha: q.fecha,
        hora: "00:00",
        agendasProfesional: q.agendas,
      }),
    });
  }

  /** Variante GET usada al seleccionar un bloque (fecha + hora). */
  getProfessionalSlotDetail(q: {
    sucursalId: number; unidadCentroMedicoId: number; especialidadId: number;
    codProf: number; fecha: string; hora: string;
  }) {
    return this.request<unknown>("GET", `${API_BASE}/AgendamientoAmbulatorio/calendarios-detalle-especialista`, {
      query: {
        empresaId: EMPRESA_ID, sucursalIds: q.sucursalId, unidadCentroMedicoId: q.unidadCentroMedicoId,
        especialidadId: q.especialidadId, "persona.id": q.codProf, fecha: q.fecha, hora: q.hora, tipoReserva: 1,
      },
    });
  }

  /** Variante GET del calendario del profesional para un bloque seleccionado. */
  getProfessionalSlotCalendar(q: {
    sucursalId: number; unidadCentroMedicoId: number; especialidadId: number;
    codProf: number; correlativoAgenda: number; fecha: string; hora: string; rut?: string;
  }) {
    return this.request<unknown>("GET", `${API_BASE}/AgendamientoAmbulatorio/calendarios-especialista`, {
      query: {
        empresaId: EMPRESA_ID, sucursalIds: q.sucursalId, unidadCentroMedicoId: q.unidadCentroMedicoId,
        especialidadId: q.especialidadId, "persona.id": q.codProf, "persona.rutCompleto": this.requireRut(q.rut),
        correlativoAgenda: q.correlativoAgenda, fecha: q.fecha, hora: q.hora, tipoReserva: 1, codProf: q.codProf,
      },
    });
  }

  // --- Validaciones ---

  getRestrictions(q: RestrictionsQuery) {
    return this.request<unknown>("POST", `${API_BASE}/restricciones/restricciones-agenda-amb`, {
      body: {
        codEmpresa: EMPRESA_ID,
        codSucursal: csv(q.sucursales ?? ALL_SUCURSALES),
        rutPaciente: this.requireRut(q.rut),
        codEspecialidad: q.especialidadId,
        tipoEspecialidad: q.tipoEspecialidad ?? 1,
        codProf: q.codProf ?? 0,
        diaSeleccionado: q.diaSeleccionado ?? "",
        idCanal: 1,
        idContexto: q.idContexto ?? 1,
      },
    });
  }

  /** ¿Hay sobrecupo para la especialidad? Lleva nonce/timestamp/signature en el body. */
  hasOverbookSpecialty(q: { especialidadId: number; proximaFecha: string; sucursales?: number[] }) {
    return this.request<unknown>("POST", `${API_BASE}/medicoSobrecupo/existeSobrecupoEspecialidad`, {
      bodySigned: true,
      body: {
        codigoProfesional: null,
        codigoEspecialidad: String(q.especialidadId),
        codigoSucursal: null,
        codigoSucursales: [{ codEmpresa: EMPRESA_ID, codSucursal: csv(q.sucursales ?? ALL_SUCURSALES), codProf: null, codEspecialidad: null }],
        proximaFechaDisponible: apiDateToChileMidnightIso(q.proximaFecha),
        profRut: null,
      },
    });
  }

  /** ¿Hay sobrecupo para el profesional? Lleva nonce/timestamp/signature en el body. */
  hasOverbookProfessional(q: { codProf: number | string; proximaFecha: string; sucursales?: number[] }) {
    return this.request<unknown>("POST", `${API_BASE}/medicoSobrecupo/existeSobrecupoProfesional`, {
      bodySigned: true,
      body: {
        codigoProfesional: String(q.codProf),
        codigoEspecialidad: null,
        codigoSucursal: null,
        codigoSucursales: [{ codEmpresa: EMPRESA_ID, codSucursal: csv(q.sucursales ?? ALL_SUCURSALES), codProf: null, codEspecialidad: null }],
        proximaFechaDisponible: apiDateToChileMidnightIso(q.proximaFecha),
        profRut: 0,
      },
    });
  }

  // --- Paciente / reserva ---

  /** Busca al paciente por RUT (paso previo al MFA de la reserva). */
  getPatientMfa(q: { sucursalId: number; rut?: string }) {
    const rutCompleto = this.requireRut(q.rut);
    const [rut, dv] = rutCompleto.split("-");
    return this.request<unknown>("GET", `${API_BASE}/pacientes/pacienteMfa`, {
      query: {
        empresaId: EMPRESA_ID, sucursalId: q.sucursalId, "persona.rut": rut,
        "persona.digitoVerificador": dv, "persona.tipoDeDocumentoId": 1, "persona.rutCompleto": rutCompleto,
      },
    });
  }

  /** Envía un código de autorización por SMS al celular del paciente. Tiene efecto real. */
  sendAuthorizationCode(q: { sucursalId: number; tipoEnvio?: "SMS"; rut?: string }) {
    return this.request<unknown>("POST", `${API_BASE}/login/enviar-codigo-autorizacion`, {
      body: {
        codClient: 500, codEmpresa: EMPRESA_ID, numeroDocumento: this.requireRut(q.rut),
        tipoDocumento: 1, tipoEnvio: q.tipoEnvio ?? "SMS", codSucursal: q.sucursalId,
      },
    });
  }
}

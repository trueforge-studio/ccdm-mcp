# ccdm-mcp

Cliente TypeScript, servidor MCP y watcher para la API de agendamiento de
**Clínica Ciudad del Mar**, reconstruidos desde un HAR del flujo "Reserva tu hora".

Sirve para buscar las horas médicas más cercanas de una especialidad en todas
las sucursales y **avisar cuando se libera una hora** (por ejemplo, las que
quedan disponibles cuando otro paciente cancela).

- `src/client.ts` — `CcdmClient`, un método por endpoint.
- `src/signature.ts` — firma Portal Único (cifrado híbrido RSA + AES).
- `src/auth.ts` — `AuthProvider` enchufable (firmador por defecto).
- `src/search.ts` — búsqueda por especialidad y detección de horas/días nuevos.
- `src/mcp.ts` — servidor MCP por stdio.
- `src/watch.ts` — watcher CLI con notificación de macOS.

Requiere Node ≥ 23.6 (ejecuta TypeScript directo, sin build). `npm test` corre la suite.

> Hecho para uso personal, a partir de tráfico propio del portal. El esquema de
> firma fue provisto por el equipo de la clínica.

## Autenticación

La API valida en cada request una firma en el header `x-portalunico-signature`,
con el esquema híbrido del frontend (ver `src/signature.ts`):

```
plaintext  = `${valueToSign}|${nonce}|${timestamp}`
signature  = base64(RSA-OAEP-SHA256(aesKey)) : base64(iv) : base64(AES-256-CBC(plaintext))
```

- `nonce` = UUID por request, `timestamp` = `Date.now()`.
- `valueToSign`: si hay body → `JSON.stringify(body)`; si no, la query string; si no, el pathname
  (con los casos especiales de `api-angular`).
- La clave pública RSA viene embebida; se puede sobrescribir con `CCDM_RSA_PUBLIC_KEY`.

Esto funciona sin configurar nada: `loadAuthProvider()` usa el firmador por defecto.
`CCDM_HEADERS` (headers fijos) o `CCDM_AUTH_MODULE` (módulo propio) siguen disponibles como alternativas.

Nota: el esquema HMAC-SHA256 anterior es legacy y no se usa.

## Endpoints

| Método del cliente | Endpoint |
|---|---|
| `consultasIniciales` | `GET www.ccdm.cl/api-angular/consultas-iniciales/{ts}` |
| `getTenant` | `GET /tenant/get-tenant` |
| `getMessages` | `GET /requestTypeMessage/lista-mensaje-por-tipo` |
| `getBranch` | `GET /tenant/branch-por-code` |
| `getMedicalCenter` | `GET /Comun/centro-medico` |
| `getSpecialtyRedirect` | `GET /redireccionPorEspecialidad/redireccion-especialidad` |
| `getSpecialtyCalendar` | `POST /AgendamientoAmbulatorio/calendarios-especialidad-reintento-oferta` |
| `getSpecialtyDayDetail` | `POST /AgendamientoAmbulatorio/calendarios-detalle-especialidad` |
| `getProfessionalCalendar` | `POST /AgendamientoAmbulatorio/calendarios-especialista-ms` |
| `getProfessionalDayDetail` | `POST /AgendamientoAmbulatorio/calendarios-detalle-especialista-ms` |
| `getProfessionalSlotDetail` | `GET /AgendamientoAmbulatorio/calendarios-detalle-especialista` |
| `getProfessionalSlotCalendar` | `GET /AgendamientoAmbulatorio/calendarios-especialista` |
| `getRestrictions` | `POST /restricciones/restricciones-agenda-amb` |
| `hasOverbookSpecialty` / `hasOverbookProfessional` | `POST /medicoSobrecupo/existeSobrecupo{Especialidad,Profesional}` |
| `getPatientMfa` | `GET /pacientes/pacienteMfa` |
| `sendAuthorizationCode` | `POST /login/enviar-codigo-autorizacion` (envía SMS real; no expuesto en el MCP) |

Las respuestas de calendario y detalle están tipadas (ver `src/client.ts`). El
resto se devuelve como JSON crudo porque aún no se han mapeado.

## MCP

```json
{
  "mcpServers": {
    "ccdm": {
      "command": "node",
      "args": ["/ruta/a/ccdm-mcp/src/mcp.ts"],
      "env": { "CCDM_RUT": "12345678-9", "CCDM_PREVISION_ID": "16" }
    }
  }
}
```

Tools de alto nivel:
- `ccdm_search_specialty`: busca especialidades por nombre (`"rodilla"`).
- `ccdm_nearest_slots`: horas más cercanas de todas las sucursales, con filtros `soloFecha`, `horaDesde` y `horaHasta`.
- `ccdm_check_new_slots`: pensada para un `/loop`. Devuelve en `nuevas` solo lo que apareció desde la revisión anterior (el estado se guarda en `~/.ccdm/watch-state.json`).

Tools de bajo nivel: `ccdm_initial_data`, `ccdm_specialty_availability`, `ccdm_specialty_day`, `ccdm_professional_availability`, `ccdm_professional_day`, `ccdm_restrictions`, `ccdm_overbook`, `ccdm_location`.

## Watcher CLI

Revisa cada 2 minutos (configurable) y lanza una notificación de macOS cuando
aparece una **hora o un día nuevo**. La línea base de la primera corrida se guarda
en `~/.ccdm/watch-state.json`.

```bash
# Horas de hoy hasta las 15:00
CCDM_RUT=12345678-9 CCDM_PREVISION_ID=16 npm run watch -- 404 --hoy --hasta 15:00

# Ventanas por día: hoy hasta 15:00 y mañana hasta 12:30
CCDM_RUT=12345678-9 CCDM_PREVISION_ID=16 npm run watch -- 404 \
  --ventana hoy:-15:00 --ventana manana:-12:30
```

Opciones: `--hoy`, `--fecha dd/MM/yyyy`, `--desde HH:mm`, `--hasta HH:mm`,
`--ventana F:D-H` (repetible; `F` = `hoy` | `manana` | `dd/MM/yyyy`),
`--sucursales 3,4`, `--cada N` (segundos), `--una-vez`.

## Respuestas

Mapeadas a partir de respuestas reales (ver `test/fixtures/`):

- `calendarios-especialidad-reintento-oferta` → `disponibilidadDias[]`: días con `codEstado: 1` y el `empresaSucursal` (sucursales y profesionales en CSV) de cada día.
- `calendarios-detalle-especialidad` → `agendasxEspComercial[].profesionales[]`: por profesional, `proxHoraDisponible` (primera hora del día), nombre, sucursal, centro (`desUnidad`) y `corregenda`.

El detalle trae **la primera hora libre de cada profesional** en el día, no todas las horas. Para "¿hay algo hoy antes de las 15:00?" alcanza.

Códigos conocidos: `404` = Traumatología rodilla (comercial; la prestación interna es `32701163`). Sucursales 3 = Centro Médico Libertad, 4 = Centro Médico Bosques.

La búsqueda de especialidades por nombre (`ccdm_search_specialty`) sigue siendo heurística porque falta ver la respuesta de `consultas-iniciales`. Con el código numérico no hace falta.

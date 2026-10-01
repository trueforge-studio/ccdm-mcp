# ccdm-client

Cliente TypeScript y servidor MCP para la API de agendamiento de Clínica Ciudad del Mar, reconstruidos desde un HAR del flujo "Reserva tu hora".

- `src/client.ts`: `CcdmClient` con todos los endpoints del HAR.
- `src/auth.ts`: interfaz `AuthProvider` (enchufable).
- `src/mcp.ts`: servidor MCP por stdio.

Requiere Node ≥ 23.6 (ejecuta TypeScript directo, sin build).

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

Las respuestas se devuelven como JSON crudo: el HAR se exportó sin cuerpos de respuesta, así que todavía no hay tipos.

## MCP

```json
{
  "mcpServers": {
    "ccdm": {
      "command": "node",
      "args": ["/Users/joaquinnunez/ccdm/src/mcp.ts"],
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

Revisa cada 2 minutos y lanza una notificación de macOS cuando aparece una hora nueva:

```bash
CCDM_RUT=12345678-9 CCDM_PREVISION_ID=16 npm run watch -- 404 --hoy --hasta 15:00 --cada 120
```

## Respuestas

Mapeadas a partir de respuestas reales (ver `test/fixtures/`):

- `calendarios-especialidad-reintento-oferta` → `disponibilidadDias[]`: días con `codEstado: 1` y el `empresaSucursal` (sucursales y profesionales en CSV) de cada día.
- `calendarios-detalle-especialidad` → `agendasxEspComercial[].profesionales[]`: por profesional, `proxHoraDisponible` (primera hora del día), nombre, sucursal, centro (`desUnidad`) y `corregenda`.

El detalle trae **la primera hora libre de cada profesional** en el día, no todas las horas. Para "¿hay algo hoy antes de las 15:00?" alcanza.

Códigos conocidos: `404` = Traumatología rodilla (comercial; la prestación interna es `32701163`). Sucursales 3 = Centro Médico Libertad, 4 = Centro Médico Bosques.

La búsqueda de especialidades por nombre (`ccdm_search_specialty`) sigue siendo heurística porque falta ver la respuesta de `consultas-iniciales`. Con el código numérico no hace falta.

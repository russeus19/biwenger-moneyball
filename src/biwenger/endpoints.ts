import { config } from '../config.js';

/**
 * API interna de Biwenger. Verificada contra la API real en septiembre de 2026.
 *
 * Ojo a los dos servidores: NO son intercambiables.
 *   - cf.biwenger.com sirve el dataset de competición.
 *   - biwenger.as.com sirve la liga, los usuarios y la ficha de cada jugador.
 * Pedir la ficha de jugador a cf devuelve 403; pedirla a biwenger.as.com
 * funciona. Lo comprobamos sondeando nueve variantes.
 */
export const HOST_APP = 'https://biwenger.as.com';
export const HOST_CDN = 'https://cf.biwenger.com';

const { competition } = config.biwenger;

/**
 * Sistema de puntuación con el que se piden los datos. NO es un detalle: el
 * parámetro `score` decide en qué sistema vienen `points`, `fitness` y el
 * desglose casa/fuera del dataset. Pedirlo con el sistema equivocado devuelve
 * números que no son los de tu liga, y el modelo entero trabaja sobre datos
 * ajenos sin que nada falle a la vista.
 *
 * Se fija tras leer la liga, que es quien dice cuál es el bueno.
 */
let scoreActivo = config.biwenger.score;
export function fijarScore(id: number): void {
  if (Number.isFinite(id) && id > 0) scoreActivo = id;
}
export function scoreEnUso(): number { return scoreActivo; }

export const endpoints = {
  /** POST. Devuelve el token a partir de email + password. */
  login: () => `${HOST_APP}${config.biwenger.loginPath}`,

  /** Cuenta, ligas a las que perteneces e ids. */
  account: () => `${HOST_APP}/api/v2/account`,

  /**
   * Dataset completo de la competición. Trae los 546 jugadores con precio,
   * puntos, estado y el desglose casa/fuera ya calculado, los equipos con sus
   * PRÓXIMOS PARTIDOS, y el calendario en `season.rounds`.
   */
  competitionData: () =>
    `${HOST_CDN}/api/v2/competitions/${competition}/data?lang=es&score=${scoreActivo}`,

  /** Mercado de tu liga: `sales` con `user: null` para los agentes libres. */
  market: () => `${HOST_APP}/api/v2/market`,

  /**
   * La liga. Devuelve `standings` con los managers y su `scoreID`, pero NO las
   * plantillas: para eso hay que preguntar por cada usuario.
   */
  league: () =>
    `${HOST_APP}/api/v2/league?include=all&fields=*,standings,scoreID,settings`,

  /** Tu equipo: saldo, plantilla con lo que pagaste, e historial de alineaciones. */
  myTeam: () => `${HOST_APP}/api/v2/user?fields=*,players(*,owner),lineups(*)`,

  /** La plantilla de otro manager. Una llamada por rival. */
  userSquad: (userId: number | string) =>
    `${HOST_APP}/api/v2/user/${userId}?fields=*,players(*)`,

  /**
   * Ficha de jugador. Aquí está lo bueno: `reports` con minutos reales en
   * `rawStats.minutesPlayed`, el partido con rival y resultado, y `prices` con
   * un año entero de histórico.
   */
  player: (id: number | string) =>
    `${HOST_APP}/api/v2/players/${competition}/${id}?fields=*,reports,prices&score=${scoreActivo}`,

  /**
   * Foto del jugador y escudo del equipo. Comprobado contra el CDN real:
   * devuelven `image/png` de verdad, no una página de error.
   *
   * La pista estaba en la clasificación de la liga, donde cada manager trae
   * `icon: "i/u/12982480.png"`. Si los usuarios van en `i/u/`, los jugadores
   * van en `i/p/` y los equipos en `i/t/`. El patrón largo con `assets/laliga`
   * que llevaba antes era una suposición mía y no existía.
   */
  playerImage: (id: number | string) =>
    (process.env.BIWENGER_PLAYER_IMG || 'https://cdn.biwenger.com/i/p/{id}.png')
      .replace('{id}', String(id)),

  teamImage: (id: number | string) =>
    (process.env.BIWENGER_TEAM_IMG || 'https://cdn.biwenger.com/i/t/{id}.png')
      .replace('{id}', String(id)),

  /** El avatar de un manager, por si alguna vez hace falta. */
  userImage: (icon: string) => `https://cdn.biwenger.com/${icon}`,
} as const;

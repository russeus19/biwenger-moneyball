import type { Position } from '../domain/types.js';

/**
 * Datos REALES de LaLiga 2026/27, sistema Biwenger AS+Sofascore (el mixto),
 * jornadas 1 a 7. Fuente: FutbolFantasy, sección "Puntos de jugadores en
 * Biwenger AS+Sofascore".
 *
 * Cada secuencia está en orden cronológico (J1 primero). `null` significa que
 * no fue calificado esa jornada: o no jugó, o jugó menos de 10 minutos. Un 0
 * es distinto: jugó y le pusieron cero.
 *
 * Verificado sumando cada secuencia contra el total publicado y comprobando la
 * media. En la fuente las secuencias van al revés, de la más reciente a la más
 * antigua; aquí ya están dadas la vuelta.
 */

export interface JugadorReal {
  nombre: string;
  position: Position;
  equipo: string;
  /** Puntos por jornada, J1 primero. null = no calificado. */
  puntos: (number | null)[];
  /** Valor de mercado real en Biwenger, si lo tengo contrastado. */
  precio?: number;
}

/**
 * Valores de mercado REALES a 19/09/2026. Fuente: Analítica Fantasy, secciones
 * de mercado y estadísticas de Biwenger.
 *
 * Merece la pena mirarlos: Camello lleva 65 puntos y vale 7,2M, Bellingham 61 y
 * vale 18,7M. Fer Niño lleva los mismos 55 que Fermín y cuesta cuatro veces
 * menos. El precio de Biwenger va detrás de la fama y de la temporada pasada,
 * no del rendimiento de esta. Justo la ineficiencia que busca el modelo.
 */
export const PRECIOS_REALES: Record<string, number> = {
  'Mbappé': 24_970_000,
  'Lamine Yamal': 22_200_000,
  'Raphinha': 20_940_000,
  'Bellingham': 18_730_000,
  'Fermín': 15_560_000,
  'Aubameyang': 14_100_000,
  'Arda Güler': 13_330_000,
  'Adeyemi': 8_940_000,
  'Baena': 8_500_000,
  'Camello': 7_200_000,
  'Zabiri': 4_930_000,
  'Fer Niño': 3_660_000,
  'Mariano': 3_740_000,
  'Álvaro Vallés': 5_280_000,
};

export const REALES: JugadorReal[] = [
  // --- Estrellas ofensivas -----------------------------------------------
  { nombre: 'Raphinha', position: 'FW', equipo: 'Barcelona', puntos: [19, 13, 18, 11, 10, 21] },
  { nombre: 'Lamine Yamal', position: 'FW', equipo: 'Barcelona', puntos: [3, 7, 18, 17, 17, 14] },
  { nombre: 'Mbappé', position: 'FW', equipo: 'Real Madrid', puntos: [4, 21, 13, 1, 17, 12] },
  { nombre: 'Bellingham', position: 'MF', equipo: 'Real Madrid', puntos: [12, 13, 15, 4, 12, 5] },
  { nombre: 'Camello', position: 'FW', equipo: 'Rayo', puntos: [2, 12, 16, 18, 11, 6] },
  { nombre: 'Aubameyang', position: 'FW', equipo: 'Deportivo', puntos: [12, 11, 13, 16, 11, 2] },
  { nombre: 'Zabiri', position: 'FW', equipo: 'Racing', puntos: [2, 1, 21, 0, 17, 11] },
  { nombre: 'Arda Güler', position: 'MF', equipo: 'Real Madrid', puntos: [9, 9, 11, 9, 10, 6] },
  { nombre: 'Adeyemi', position: 'FW', equipo: 'Barcelona', puntos: [10, 4, 6, 5, 13, 11] },
  { nombre: 'Fermín', position: 'MF', equipo: 'Barcelona', puntos: [19, 13, 4, 16, 3, null] },
  { nombre: 'Pedri', position: 'MF', equipo: 'Barcelona', puntos: [5, 11, 5, 15, 3, 6] },
  { nombre: 'Baena', position: 'MF', equipo: 'Atlético', puntos: [11, 2, 20, 3, 2, 13] },
  { nombre: 'Kang-In Lee', position: 'MF', equipo: 'Atlético', puntos: [14, 3, 6, 2, 3, 16] },
  { nombre: 'Budimir', position: 'FW', equipo: 'Osasuna', puntos: [6, 6, 10, 16, 4, 3] },
  { nombre: 'Pape Gueye', position: 'MF', equipo: 'Villarreal', puntos: [12, 6, 3, 4, 3, 19] },
  { nombre: 'Mariano', position: 'FW', equipo: 'Alavés', puntos: [16, 10, 3, 12, 3, 4] },
  { nombre: 'Boyé', position: 'FW', equipo: 'Alavés', puntos: [null, 3, 10, 23, 2, 2] },
  { nombre: 'Iñigo Vicente', position: 'MF', equipo: 'Racing', puntos: [6, 4, 10, 5, 11, 3] },
  { nombre: 'Moleiro', position: 'MF', equipo: 'Villarreal', puntos: [3, 5, 3, 5, 3, 13] },
  { nombre: 'Dani Olmo', position: 'MF', equipo: 'Barcelona', puntos: [4, 6, 4, 11, 2, 10] },
  { nombre: 'Luis Suárez Sucic', position: 'MF', equipo: 'Real Sociedad', puntos: [2, 8, 3, 2, 13, 4] },
  { nombre: 'Miguel Sierra', position: 'MF', equipo: 'Sevilla', puntos: [6, 6, 10, 3, 2, 11] },
  { nombre: 'Germán Valera', position: 'FW', equipo: 'Elche', puntos: [6, -1, 1, 6, 5, 3, 13] },
  { nombre: 'Fer Niño', position: 'FW', equipo: 'Elche', puntos: [2, 3, 10, 11, 2, 10, 17] },

  // --- Porteros -----------------------------------------------------------
  { nombre: 'Álvaro Vallés', position: 'GK', equipo: 'Betis', puntos: [5, 9, 2, 12, 12, 9] },
  { nombre: 'David Soria', position: 'GK', equipo: 'Getafe', puntos: [6, 10, 4, 6, 5, 11] },
  { nombre: 'Sivera', position: 'GK', equipo: 'Alavés', puntos: [5, 5, 8, 8, 6, 5] },
  { nombre: 'Joan Garcia', position: 'GK', equipo: 'Barcelona', puntos: [6, 5, 4, 10, 6, 2] },
  { nombre: 'Courtois', position: 'GK', equipo: 'Real Madrid', puntos: [2, 3, 3, 3, 8, 2] },
  { nombre: 'Oblak', position: 'GK', equipo: 'Atlético', puntos: [3, 9, 5, -1, 5, 4] },
  { nombre: 'Agirrezabala', position: 'GK', equipo: 'Racing', puntos: [4, 3, 4, 3, 9, 6] },
  { nombre: 'Leo Román', position: 'GK', equipo: 'Deportivo', puntos: [9, 7, 4, 3, 3, 5] },
  { nombre: 'Radu', position: 'GK', equipo: 'Celta', puntos: [3, 1, 11, 9, 3, 3] },
  { nombre: 'Dimitrievski', position: 'GK', equipo: 'Valencia', puntos: [5, 1, 4, 7, 3, 7] },
  { nombre: 'Unai Simón', position: 'GK', equipo: 'Athletic', puntos: [-4, 12, 7, 9, 3] },
  { nombre: 'Vlachodimos', position: 'GK', equipo: 'Sevilla', puntos: [4, 6, -2, 6, 3, 9] },
  { nombre: 'Szczesny', position: 'GK', equipo: 'Barcelona', puntos: [null, null, null, null, null, -2] },

  // --- Defensas -----------------------------------------------------------
  { nombre: 'Cubarsí', position: 'DF', equipo: 'Barcelona', puntos: [null, 8, 4, 7, 7, null] },
  { nombre: 'Huijsen', position: 'DF', equipo: 'Real Madrid', puntos: [4, 4, 6, 7, null, 2] },
  { nombre: 'Cucurella', position: 'DF', equipo: 'Real Madrid', puntos: [3, 5, 6, 3, 0, 1] },
  { nombre: 'Carreras', position: 'DF', equipo: 'Real Madrid', puntos: [3, 2, null, 2, 14, null] },
  { nombre: 'Pubill', position: 'DF', equipo: 'Atlético', puntos: [null, 13, 5, 2, 4, 3] },
  { nombre: 'Hancko', position: 'DF', equipo: 'Atlético', puntos: [8, 3, 4, 2, 4, 2] },
  { nombre: 'Aramburu', position: 'DF', equipo: 'Real Sociedad', puntos: [1, 3, 3, 9, 5, 5] },
  { nombre: 'Natan', position: 'DF', equipo: 'Betis', puntos: [7, null, 1, 7, 13, 7] },
  { nombre: 'Tenaglia', position: 'DF', equipo: 'Alavés', puntos: [16, 5, 6, 3, 5, 5] },
  { nombre: 'Laporte', position: 'DF', equipo: 'Athletic', puntos: [5, 5, 0, 6, 6, 4] },
  { nombre: 'Gabriel Suazo', position: 'DF', equipo: 'Sevilla', puntos: [3, 3, -1, 4, 8, 6] },
  { nombre: 'Juan Iglesias', position: 'DF', equipo: 'Sevilla', puntos: [4, 7, 2, 3, 14, 4] },
  { nombre: 'Eric Garcia', position: 'DF', equipo: 'Barcelona', puntos: [8, 7, null, 2, 3, 5] },
  { nombre: 'Marc Bartra', position: 'DF', equipo: 'Betis', puntos: [5, null, 12, 8, 5, null] },
  { nombre: 'Yuri', position: 'DF', equipo: 'Athletic', puntos: [-7, null, 6, 4, 4] },
  { nombre: 'Lejeune', position: 'DF', equipo: 'Rayo', puntos: [0, 3, 1, 5, -4, 3] },
  { nombre: 'Bretones', position: 'DF', equipo: 'Osasuna', puntos: [4, 2, 4, -2, 4, -4] },
  { nombre: 'Javi Galán', position: 'DF', equipo: 'Celta', puntos: [5, 2, null, 3, 3, 2] },
  { nombre: 'Manu Hernando', position: 'DF', equipo: 'Racing', puntos: [4, 2, 8, 1, null, -3] },
  { nombre: 'Angeliño', position: 'DF', equipo: 'Deportivo', puntos: [null, null, null, null, null, -6] },

  // --- Medios y delanteros de perfil medio --------------------------------
  { nombre: 'Valverde', position: 'MF', equipo: 'Real Madrid', puntos: [4, 6, 6, 3, 4, 6] },
  { nombre: 'Vinicius', position: 'FW', equipo: 'Real Madrid', puntos: [4, 11, 5, 4, 6, -2] },
  { nombre: 'Oyarzabal', position: 'FW', equipo: 'Real Sociedad', puntos: [4, 2, 9, 3, 3, 0] },
  { nombre: 'Isco', position: 'MF', equipo: 'Betis', puntos: [3, 2, 3, 5, 5, 6] },
  { nombre: 'Aspas', position: 'FW', equipo: 'Celta', puntos: [3, 10, 5, 3, 3, 4] },
  { nombre: 'Hugo Duro', position: 'FW', equipo: 'Valencia', puntos: [2, 2, 2, 2, 3, 3] },
  { nombre: 'Raúl García', position: 'MF', equipo: 'Osasuna', puntos: [3, 3, 4, 3, 3, 2] },
  { nombre: 'Moriba', position: 'MF', equipo: 'Celta', puntos: [3, 0, 0, 4, 2, 6] },
  { nombre: 'Ayoze', position: 'FW', equipo: 'Villarreal', puntos: [3, 3, 3, 5, 2, 5] },
  { nombre: 'Cucho Hernández', position: 'FW', equipo: 'Betis', puntos: [6, 2, 1, 2, 10, 2] },
  { nombre: 'Chupete', position: 'FW', equipo: 'Málaga', puntos: [-2, 9, 1, 0, -1, 1] },
  { nombre: 'Julián Álvarez', position: 'FW', equipo: 'Atlético', puntos: [null, 0, null, 3, null, null] },
  { nombre: 'Enes Ünal', position: 'FW', equipo: 'Getafe', puntos: [2, 11, 2, 3, 2, 2] },
  { nombre: 'Guruzeta', position: 'FW', equipo: 'Athletic', puntos: [3, 2, 2, 2, null] },
  { nombre: 'Pere Milla', position: 'FW', equipo: 'Espanyol', puntos: [2, 2, null, 3, null, 2] },
];

/**
 * Precio estimado para los jugadores cuyo valor real no tengo contrastado.
 * Es una aproximación gruesa a partir de puntos y posición, y por eso viaja
 * marcada: los precios reales de Biwenger tienen una dispersión enorme para el
 * mismo rendimiento, así que cualquier estimación se equivoca mucho.
 */
const BASE_POSICION: Record<Position, number> = {
  GK: 3_000_000, DF: 2_500_000, MF: 3_000_000, FW: 3_500_000,
};

export function precioDe(d: JugadorReal): { precio: number; real: boolean } {
  const real = PRECIOS_REALES[d.nombre];
  if (real) return { precio: real, real: true };
  const total = d.puntos.reduce((s: number, p) => s + (p ?? 0), 0);
  const estimado = BASE_POSICION[d.position] + total * 170_000;
  return { precio: Math.max(500_000, Math.round(estimado / 10_000) * 10_000), real: false };
}

/** Convierte al formato que consume el motor. */
export function comoPlayers(
  datos: JugadorReal[],
  hastaJornada: number,
): import('../domain/types.js').Player[] {
  const equipos = [...new Set(datos.map((d) => d.equipo))];
  return datos.map((d, i) => {
    const reports = d.puntos.slice(0, hastaJornada).map((p, j) => ({
      round: j + 1,
      points: p ?? 0,
      // No tenemos minutos reales: si fue calificado asumimos partido completo,
      // que es lo que hace también el adaptador cuando la API no los da.
      minutes: p === null ? 0 : 90,
      // No tengo el dato real de dónde se jugó cada jornada, así que se deja
      // sin definir. Inventarlo alternando local y visitante metía ruido en la
      // medición de ventaja de campo, que es una calibración real del motor.
      home: undefined,
    }));
    return {
      id: 9000 + i,
      name: d.nombre,
      slug: d.nombre.toLowerCase().replace(/\s+/g, '-'),
      position: d.position,
      teamId: equipos.indexOf(d.equipo),
      teamName: d.equipo,
      price: precioDe(d).precio,
      priceDelta: 0,
      availability: 'ok' as const,
      points: reports.reduce((s, r) => s + r.points, 0),
      matchesPlayed: reports.filter((r) => r.minutes > 0).length,
      reports,
    };
  });
}

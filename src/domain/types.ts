export type Position = 'GK' | 'DF' | 'MF' | 'FW';

export const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];

/** Disponibilidad. Multiplica la probabilidad de jugar, no resta puntos. */
export type Availability = 'ok' | 'doubt' | 'injured' | 'suspended' | 'out';

export interface RoundReport {
  round: number;
  /** "J3", para enseñarlo tal cual lo llama Biwenger. */
  roundName?: string;
  points: number;
  /** Minutos jugados. Si la API no los da, se infiere del evento de alineación. */
  minutes: number;
  /** true = jugó en casa. undefined = no lo sabemos, y entonces no se usa. */
  home?: boolean;
  /** Id del rival, para ajuste de calendario y para el histórico. */
  opponentTeamId?: number;
  goals?: number;
  assists?: number;
  /** Resultado del partido, para pintarlo como hace Biwenger. */
  homeTeamId?: number;
  awayTeamId?: number;
  homeGoals?: number;
  awayGoals?: number;
  /** Eventos que Biwenger muestra como iconos a la derecha de la barra. */
  yellow?: number;
  red?: boolean;
  ownGoals?: number;
  penaltySaved?: number;
  penaltyMissed?: number;
  opponentName?: string;
  cleanSheet?: boolean;
  /** Eventos en crudo, por si hiciera falta el minuto exacto de cada cosa. */
  rawEvents?: unknown[];
  goalsPenalty?: number;
  mvp?: boolean;
  resultado?: 'win' | 'lost' | 'tie';
}

export interface Player {
  id: number;
  name: string;
  slug: string;
  position: Position;
  teamId: number;
  teamName: string;
  /** Valor de mercado actual que fija Biwenger, en euros. */
  price: number;
  /** Variación de precio en la última actualización, en euros. */
  priceDelta: number;
  availability: Availability;
  /** Puntos totales de la temporada. */
  points: number;
  matchesPlayed: number;
  reports: RoundReport[];
  /** Histórico de valor de mercado: [timestamp ms, euros]. Lo da la API. */
  priceHistory?: Array<[number, number]>;
  /** Desglose casa/fuera, que Biwenger ya da calculado. */
  homeSplit?: { pointsHome: number; playedHome: number; pointsAway: number; playedAway: number };
}

export type MarketOrigin = 'free' | 'manager';

export interface MarketEntry {
  playerId: number;
  /** Precio de salida pedido. */
  askingPrice: number;
  origin: MarketOrigin;
  sellerUserId?: number;
  /** Timestamp de cierre de la subasta. */
  expiresAt?: number;
}

export interface SquadPlayer {
  playerId: number;
  ownerUserId: number;
  /** Lo que pagó su dueño, si la API lo expone. */
  boughtFor?: number;
}

export interface Manager {
  userId: number;
  name: string;
  /** Saldo disponible, en euros. Solo lo sabes con certeza del tuyo. */
  balance?: number;
  squad: SquadPlayer[];
  /** Lo que la clasificación sí revela de tus rivales. */
  teamValue?: number;
  teamSize?: number;
  leaguePoints?: number;
  leaguePosition?: number;
}

export interface LeagueState {
  date: string; // YYYY-MM-DD
  currentRound: number;
  players: Player[];
  market: MarketEntry[];
  managers: Manager[];
  me: {
    userId: number;
    balance: number;
    squad: SquadPlayer[];
    /** Ids de los 11 que tienes puestos ahora mismo, si la API los expone. */
    currentLineup?: number[];
  };
}

/** Salida del motor para un jugador concreto. */
export interface Valuation {
  playerId: number;
  /** Puntos proyectados en el horizonte configurado. */
  projectedPoints: number;
  /** Probabilidad de ser alineado, 0-1. */
  startProbability: number;
  expectedMinutes: number;
  /** Puntos por 90 ya regresados a la media. */
  shrunkPer90: number;
  /** Desviación típica de sus puntuaciones. Fiabilidad. */
  volatility: number;
  /** Puntos que aporta por encima del nivel de reemplazo de su posición. */
  pointsOverReplacement: number;
  /** Techo de compra en euros. Por encima, el dinero rinde más en otro sitio. */
  maxBid: number;
  /** Nota 0-10 de la OPERACIÓN: cuánto compensa al precio que piden. */
  score: number;
  /** Nota 0-10 del JUGADOR en sí, por percentil dentro de su posición. */
  quality?: number;
  /** Plusvalía esperada: el precio de Biwenger persigue a los puntos. */
  appreciation?: { precioJusto: number; esperada: number; porcentaje: number };
  /** Parte del techo que viene solo de los puntos, sin contar plusvalía. */
  valueFromPoints?: number;
  /** Desglose legible de por qué esa nota. */
  reasons: string[];
}

export type Action = 'buy' | 'hold' | 'sell' | 'avoid';

export interface Recommendation extends Valuation {
  action: Action;
  askingPrice?: number;
  /** Puja sugerida, por debajo del techo. */
  suggestedBid?: number;
  /** Jugador de tu plantilla al que desplazaría del once. */
  displacesPlayerId?: number;
}

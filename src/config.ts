import 'dotenv/config';

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback = ''): string {
  return process.env[key]?.trim() ?? fallback;
}

export const config = {
  biwenger: {
    token: str('BIWENGER_TOKEN'),
    email: str('BIWENGER_EMAIL'),
    password: str('BIWENGER_PASSWORD'),
    league: str('BIWENGER_LEAGUE'),
    user: str('BIWENGER_USER'),
    version: str('BIWENGER_VERSION'),
    loginPath: str('BIWENGER_LOGIN_PATH', '/api/v2/auth/login'),
    competition: str('BIWENGER_COMPETITION', 'la-liga'),
    score: num('BIWENGER_SCORE', 2),
  },
  engine: {
    horizonRounds: num('HORIZON_ROUNDS', 6),
    shrinkageK: num('SHRINKAGE_K', 4),
    formHalflife: num('FORM_HALFLIFE', 8),
    minutesHalflife: num('MINUTES_HALFLIFE', 6),
    alertThreshold: num('ALERT_THRESHOLD', 8),
    // Ajuste "Puja máxima" de tu liga: saldo | saldo25 | saldo50 | ilimitada
    modoPuja: str('BIWENGER_BID_MODE', 'saldo25'),
  },
  telegram: {
    botToken: str('TELEGRAM_BOT_TOKEN'),
    chatId: str('TELEGRAM_CHAT_ID'),
  },
  dbPath: str('DB_PATH', './data/biwenger.db'),
  rawDir: str('RAW_DIR', './data/raw'),
  port: num('PORT', 8787),
};

/** Enmascara secretos para logs. */
export function mask(value: string): string {
  if (!value) return '(vacío)';
  return value.length <= 8 ? '***' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function assertAuthConfig(): void {
  const { token, email, password, league, user } = config.biwenger;
  if (!token && !(email && password)) {
    throw new Error('Falta BIWENGER_TOKEN, o bien BIWENGER_EMAIL + BIWENGER_PASSWORD.');
  }
  // Con email y contraseña, liga y usuario se autodescubren desde la cuenta.
  if (token && (!league || !user)) {
    throw new Error(
      'Con BIWENGER_TOKEN hacen falta también BIWENGER_LEAGUE y BIWENGER_USER. ' +
        'Si usas email y contraseña, se descubren solos.',
    );
  }
}

import { config, mask, assertAuthConfig } from '../config.js';
import { endpoints } from './endpoints.js';

/**
 * Cliente de solo lectura. Deliberadamente NO expone POST/PUT/DELETE contra
 * Biwenger: el sistema recomienda, tú pulsas. Automatizar escrituras choca con
 * las normas de la plataforma.
 */
export class BiwengerClient {
  private token = '';
  private league = config.biwenger.league;
  private user = config.biwenger.user;
  private lastRequest = 0;
  /** ms mínimos entre peticiones, para no martillear la API. */
  private readonly minGap = 900;

  async init(): Promise<void> {
    assertAuthConfig();
    if (config.biwenger.token) {
      this.token = config.biwenger.token;
      console.log(`[auth] token de entorno ${mask(this.token)}`);
      return;
    }
    this.token = await this.login();
    console.log(`[auth] login correcto, token ${mask(this.token)}`);
    await this.discover();
  }

  /**
   * Saca leagueId y userId de la propia cuenta. Sin esto había que abrir
   * DevTools y copiar cabeceras a mano, que es el paso donde más gente
   * abandona. Con email y contraseña ya no hace falta nada más.
   */
  private async discover(): Promise<void> {
    if (this.league && this.user) return;
    const res = await fetch(endpoints.account(), {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(
        `No pude leer la cuenta (${res.status}). Rellena BIWENGER_LEAGUE y ` +
          `BIWENGER_USER a mano desde DevTools.`,
      );
    }
    const body = (await res.json()) as any;
    const data = body?.data ?? body;
    const leagues: any[] = data?.leagues ?? [];
    const first = leagues[0];
    if (!first?.id) {
      throw new Error(
        `La cuenta no devuelve ligas. Claves recibidas: ${Object.keys(data ?? {}).join(', ')}`,
      );
    }
    if (leagues.length > 1) {
      console.log(
        `[auth] tienes ${leagues.length} ligas: ` +
          leagues.map((l: any) => `${l.id} (${l.name ?? '?'})`).join(', ') +
          `. Uso la primera; fija BIWENGER_LEAGUE para elegir otra.`,
      );
    }
    this.league = String(first.id);
    this.user = String(first.user?.id ?? data?.account?.id ?? '');
    console.log(`[auth] liga ${this.league}, usuario ${this.user}`);
  }

  private async login(): Promise<string> {
    const res = await fetch(endpoints.login(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: config.biwenger.email,
        password: config.biwenger.password,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Login falló (${res.status}). Verifica BIWENGER_LOGIN_PATH en DevTools: ` +
          `puede que la ruta haya cambiado.`,
      );
    }
    const body = (await res.json()) as Record<string, any>;
    // La forma exacta varía. Probamos las ubicaciones habituales del token.
    const token: unknown = body?.token ?? body?.data?.token ?? body?.data?.jwt;
    if (typeof token !== 'string' || !token) {
      throw new Error(
        `Login OK pero no encuentro el token en la respuesta. Claves recibidas: ` +
          `${Object.keys(body).join(', ')}. Ajusta client.login().`,
      );
    }
    return token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-League': this.league,
      'X-User': this.user,
      'X-Lang': 'es',
      // Cloudflare protege cf.biwenger.com y rechaza lo que huele a robot.
      // Sin estas tres cabeceras, la petición sale con el agente de usuario de
      // Node y desde una IP de centro de datos devuelve 403 siempre, aunque el
      // token sea perfectamente válido. Desde una conexión doméstica cuela.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9',
      Referer: 'https://biwenger.as.com/',
    };
    if (config.biwenger.version) h['X-Version'] = config.biwenger.version;
    return h;
  }

  /**
   * Los datos de competición los sirven dos hosts. `cf.biwenger.com` es el
   * habitual, pero es el que Cloudflare bloquea desde servidores. Si falla, se
   * intenta la misma ruta en `biwenger.as.com`, que responde a login y liga sin
   * problemas desde cualquier sitio.
   */
  private alternativa(url: string): string | null {
    if (url.includes('cf.biwenger.com')) {
      return url.replace('https://cf.biwenger.com', 'https://biwenger.as.com');
    }
    return null;
  }

  private async throttle(): Promise<void> {
    const wait = this.minGap - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  /**
   * GET crudo, con reintentos.
   *
   * Biwenger tiene Cloudflare delante y corta con 403 cuando le llegan muchas
   * peticiones seguidas, aunque el token sea perfectamente válido. Rendirse al
   * primer 403 hacía fallar el snapshot entero por una racha pasajera, así que
   * se reintenta esperando cada vez más.
   */
  async get<T = unknown>(url: string, intentos = 3): Promise<T> {
    let ultimoError = '';

    for (let intento = 0; intento < intentos; intento++) {
      await this.throttle();
      let res: Response;
      try {
        res = await fetch(url, { headers: this.headers() });
      } catch (err) {
        ultimoError = (err as Error).message;
        await this.esperar(intento);
        continue;
      }

      if (res.ok) {
        const body = (await res.json()) as any;
        // Biwenger envuelve casi todo en { status, data }.
        return (body?.data ?? body) as T;
      }

      // 401 es token malo de verdad: reintentar no arregla nada.
      if (res.status === 401) {
        throw new Error(`401 en ${url}. El token no es válido.`);
      }

      ultimoError = `${res.status} ${res.statusText}`;
      const reintentable = res.status === 403 || res.status === 429 || res.status >= 500;
      if (!reintentable || intento === intentos - 1) break;

      console.warn(`  [reintento ${intento + 1}] ${res.status} en ${url.slice(0, 70)}…`);
      await this.esperar(intento);
    }

    // Último recurso: el otro host.
    const otra = this.alternativa(url);
    if (otra) {
      console.warn(`  [host alternativo] probando ${otra.slice(0, 60)}…`);
      try {
        await this.throttle();
        const res = await fetch(otra, { headers: this.headers() });
        if (res.ok) {
          const body = (await res.json()) as any;
          return (body?.data ?? body) as T;
        }
        ultimoError = `${ultimoError} · alternativa: ${res.status}`;
      } catch (err) {
        ultimoError = `${ultimoError} · alternativa: ${(err as Error).message}`;
      }
    }

    throw new Error(
      `${ultimoError} en ${url}\n` +
        `  Un 403 constante en cf.biwenger.com suele ser Cloudflare bloqueando\n` +
        `  IP de centros de datos. Desde casa funciona; desde un servidor no.`,
    );
  }

  /** Espera creciente: 2, 6 y 14 segundos. */
  private esperar(intento: number): Promise<void> {
    const ms = 2000 * (2 ** intento) - 2000 + 2000;
    return new Promise((r) => setTimeout(r, ms));
  }
}

export async function makeClient(): Promise<BiwengerClient> {
  const c = new BiwengerClient();
  await c.init();
  return c;
}

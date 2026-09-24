import { WS_CLOSE_CODES, WS_CLOSE_REASONS } from '@for/contracts';
import { describe, expect, it } from 'vitest';

import type { SocketLike } from './socket.js';
import {
  FATAL_CLOSE_REASONS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  RETRYABLE_CLOSE_REASONS,
  backoffDelayMs,
  connect,
  isFatalClose,
} from './socket.js';

function fakeSocket(): SocketLike & { envoyes: string[]; ferme: boolean } {
  return {
    envoyes: [],
    ferme: false,
    send(data: string) {
      this.envoyes.push(data);
    },
    close() {
      this.ferme = true;
    },
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  };
}

describe('le recul exponentiel', () => {
  it('double a chaque tentative depuis 500 ms', () => {
    // Les chiffres sont ecrits en toutes lettres : ils ne se comparent pas a la
    // constante qu'ils verifient (ADR 0007).
    expect(backoffDelayMs(0)).toBe(500);
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(5)).toBe(16_000);
  });

  it('plafonne a 30 secondes, quelle que soit la tentative', () => {
    expect(backoffDelayMs(30)).toBe(30_000);
    expect(backoffDelayMs(200)).toBe(30_000);
  });

  it('les constantes exportees disent ce que le test mesure', () => {
    expect(RECONNECT_BASE_MS).toBe(500);
    expect(RECONNECT_MAX_MS).toBe(30_000);
  });
});

describe('les codes de fermeture', () => {
  it('les deux moities couvrent exactement la liste des contrats', () => {
    // LA SOURCE DE LA BOUCLE EST `WS_CLOSE_REASONS`, pas les deux tableaux
    // d'ici : un code ajoute en amont doit etre classe, pas silencieusement
    // reessaye.
    const classes = [...FATAL_CLOSE_REASONS, ...RETRYABLE_CLOSE_REASONS].sort();
    expect(classes).toEqual([...WS_CLOSE_REASONS].sort());
  });

  it.each([...FATAL_CLOSE_REASONS])('« %s » ne se réessaye pas', (raison) => {
    expect(isFatalClose(WS_CLOSE_CODES[raison])).toBe(true);
  });

  it.each([...RETRYABLE_CLOSE_REASONS])('« %s » se réessaye', (raison) => {
    expect(isFatalClose(WS_CLOSE_CODES[raison])).toBe(false);
  });

  it('une coupure réseau ordinaire (1006) se réessaye', () => {
    expect(isFatalClose(1006)).toBe(false);
  });
});

describe('la connexion', () => {
  it('annonce son ouverture et laisse le store envoyer son hello', () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const etats: string[] = [];
    let helloEnvoye = 0;

    connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: () => undefined,
      onFrame: () => undefined,
      onStatus: (status) => etats.push(status),
      onOpen: () => {
        helloEnvoye += 1;
      },
    });

    sockets[0]?.onopen?.();
    expect(etats).toEqual(['connecting', 'open']);
    expect(helloEnvoye).toBe(1);
  });

  it('replanifie apres une coupure, avec un delai qui croit', () => {
    const delais: number[] = [];
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const rappels: (() => void)[] = [];

    connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (run, delayMs) => {
        delais.push(delayMs);
        rappels.push(run);
      },
      onFrame: () => undefined,
      onStatus: () => undefined,
      onOpen: () => undefined,
    });

    sockets[0]?.onclose?.({ code: 1006 });
    rappels[0]?.();
    sockets[1]?.onclose?.({ code: 1006 });

    expect(delais).toEqual([500, 1000]);
    expect(sockets).toHaveLength(2);
  });

  it('ne se reconnecte pas apres une fermeture definitive', () => {
    const delais: number[] = [];
    const sockets: ReturnType<typeof fakeSocket>[] = [];

    connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (_run, delayMs) => {
        delais.push(delayMs);
      },
      onFrame: () => undefined,
      onStatus: () => undefined,
      onOpen: () => undefined,
    });

    sockets[0]?.onclose?.({ code: WS_CLOSE_CODES.unauthenticated });
    expect(delais).toEqual([]);
  });

  it('une fermeture demandee par le client ne se reconnecte pas non plus', () => {
    const delais: number[] = [];
    const sockets: ReturnType<typeof fakeSocket>[] = [];

    const handle = connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (_run, delayMs) => {
        delais.push(delayMs);
      },
      onFrame: () => undefined,
      onStatus: () => undefined,
      onOpen: () => undefined,
    });

    handle.close();
    sockets[0]?.onclose?.({ code: 1006 });
    expect(delais).toEqual([]);
    expect(sockets[0]?.ferme).toBe(true);
  });

  it('remet le compteur a zero apres une ouverture reussie', () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const rappels: (() => void)[] = [];
    const delais: number[] = [];

    const handle = connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (run, delayMs) => {
        delais.push(delayMs);
        rappels.push(run);
      },
      onFrame: () => undefined,
      onStatus: () => undefined,
      onOpen: () => undefined,
    });

    sockets[0]?.onclose?.({ code: 1006 });
    rappels[0]?.();
    sockets[1]?.onopen?.();
    expect(handle.attempts()).toBe(0);

    sockets[1]?.onclose?.({ code: 1006 });
    expect(delais).toEqual([500, 500]);
  });

  it('transmet la trame decodee, et la trame indecodable telle quelle', () => {
    const recues: unknown[] = [];
    const sockets: ReturnType<typeof fakeSocket>[] = [];

    connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: () => undefined,
      onFrame: (raw) => recues.push(raw),
      onStatus: () => undefined,
      onOpen: () => undefined,
    });

    sockets[0]?.onmessage?.({ data: '{"v":1}' });
    sockets[0]?.onmessage?.({ data: 'pas du json' });

    expect(recues).toEqual([{ v: 1 }, 'pas du json']);
  });

  it('envoie du JSON sur la socket ouverte', () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const handle = connect({
      url: 'ws://test/ws',
      open: () => {
        const socket = fakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: () => undefined,
      onFrame: () => undefined,
      onStatus: () => undefined,
      onOpen: () => undefined,
    });

    handle.send({ t: 'c2s.pong' });
    expect(sockets[0]?.envoyes).toEqual(['{"t":"c2s.pong"}']);
  });
});

import { describe, expect, it } from 'vitest';

import { readClientEnv, websocketUrl } from './env.js';

describe('la configuration du client', () => {
  it('sans rien de configuré, tout vaut « même origine »', () => {
    const env = readClientEnv({});
    expect(env.VITE_API_BASE_URL).toBe('');
    expect(env.VITE_WS_URL).toBe('');
  });

  it('refuse une base d’API avec une barre oblique finale', () => {
    expect(() => readClientEnv({ VITE_API_BASE_URL: 'https://exemple.fr/' })).toThrow(
      /barre oblique/u,
    );
  });

  it('refuse une URL de socket en http', () => {
    expect(() => readClientEnv({ VITE_WS_URL: 'https://exemple.fr' })).toThrow(/ws:\/\//u);
  });

  it('dérive la socket de l’origine de la page quand rien n’est configuré', () => {
    const env = readClientEnv({});
    expect(websocketUrl(env, 'https://jeu.exemple.fr', 'abc')).toBe(
      'wss://jeu.exemple.fr/ws?campaignId=abc',
    );
    expect(websocketUrl(env, 'http://localhost:5173', 'abc')).toBe(
      'ws://localhost:5173/ws?campaignId=abc',
    );
  });

  it('utilise l’URL configurée quand il y en a une', () => {
    const env = readClientEnv({ VITE_WS_URL: 'wss://ws.exemple.fr' });
    expect(websocketUrl(env, 'https://jeu.exemple.fr', 'a b')).toBe(
      'wss://ws.exemple.fr/ws?campaignId=a%20b',
    );
  });
});

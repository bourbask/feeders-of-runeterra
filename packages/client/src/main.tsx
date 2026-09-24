import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import type { HttpDeps } from './api/http.js';
import { clientEnv } from './env.js';
import './styles/global.css';

/**
 * The entry point: providers, and nothing else. Every dependency the screens
 * need — the base URL, `fetch` — is handed down as a value, so a test renders
 * `App` without touching a global.
 */
const http: HttpDeps = {
  baseUrl: clientEnv.VITE_API_BASE_URL,
  fetch: globalThis.fetch.bind(globalThis),
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Un refus d'authentification ne devient pas vrai en reessayant.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const racine = document.querySelector('#racine');
if (racine === null) throw new Error('#racine est absent de index.html');

createRoot(racine).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App http={http} />
    </QueryClientProvider>
  </StrictMode>,
);

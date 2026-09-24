import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sans ce demontage, un composant d'un test precedent reste dans le document et
// la requete du test suivant trouve deux elements « Pourquoi ? » : le test passe
// ou echoue pour une raison qui n'est pas la sienne.
afterEach(() => {
  cleanup();
});

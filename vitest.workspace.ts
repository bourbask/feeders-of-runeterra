import { defineWorkspace } from 'vitest/config';

// Un projet par paquet. Les seuils de couverture vivent ici, pas dans un tableau
// de documentation : quatre tâches plus loin s'appuient dessus pour leurs critères.
export default defineWorkspace(['packages/*/vitest.config.ts']);

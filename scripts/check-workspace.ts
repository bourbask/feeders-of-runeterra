/**
 * Cohérence de l'espace de travail.
 *
 * Deux choses qu'aucun compilateur ne vérifie et dont quatre tâches dépendent :
 * que chaque paquet porte les cinq scripts obligatoires, et que la racine porte
 * la liste contractuelle de commandes de 01-architecture.md §2.2 — parce qu'un
 * critère d'acceptation qui invoque une commande absente est un faux critère.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const SCRIPTS_DE_PAQUET = [
  'build',
  'typecheck',
  // Les tests sont hors du tsconfig de build : sans cette passe, un fichier de
  // test peut porter une erreur de type franche sans qu'aucune porte ne bronche.
  'typecheck:tests',
  'lint',
  'test',
  'test:watch',
] as const;

const COMMANDES_RACINE = [
  'dev',
  'build',
  'verify',
  'test',
  // Le seul chemin qui évalue le seuil global de couverture : `turbo run test`
  // lance les configurations de paquet, qui ne le connaissent pas. Le job 6 de la
  // CI doit appeler celle-ci (ADR 0002).
  'test:coverage',
  'lint',
  'typecheck',
  'format:check',
  'format',
  'depcruise',
  'check:workspace',
  'test:golden',
  'golden:update',
  'sim',
  'db:generate',
  'db:check-schema',
  'db:migrate',
  'db:studio',
  'db:seed',
  'db:reset',
  'db:rebuild',
  'db:check',
  'content:index',
  'content:check',
  'eval:offline',
  'eval:record',
  'eval:live',
  'eval:judge',
  'eval:smoke',
  'eval:probe',
] as const;

interface Manifeste {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const lire = (chemin: string): Manifeste => JSON.parse(readFileSync(chemin, 'utf8')) as Manifeste;

const soucis: string[] = [];

const racine = lire('package.json');
for (const commande of COMMANDES_RACINE) {
  if (!racine.scripts?.[commande]) {
    soucis.push(
      `package.json racine : la commande « ${commande} » manque (liste contractuelle, 01-architecture.md §2.2)`,
    );
  }
}

const paquets = readdirSync('packages', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (paquets.length === 0) soucis.push('aucun paquet trouvé sous packages/');

// Une version d'une dépendance externe doit être la même partout : deux versions
// de zod dans le graphe et les types ne se parlent plus.
const versions = new Map<string, Map<string, string[]>>();

for (const paquet of paquets) {
  const chemin = join('packages', paquet, 'package.json');
  if (!existsSync(chemin)) {
    soucis.push(`packages/${paquet} : package.json manquant`);
    continue;
  }
  const m = lire(chemin);
  for (const script of SCRIPTS_DE_PAQUET) {
    if (!m.scripts?.[script]) soucis.push(`packages/${paquet} : le script « ${script} » manque`);
  }
  /**
   * UN SCRIPT QUI LIT LE `.env` DE LA RACINE DOIT DÉMARRER DEPUIS LA RACINE.
   *
   * npm lance le script d'un paquet depuis le dossier de ce paquet. Les
   * chemins du `.env` sont relatifs au processus, pas au dépôt : `pnpm
   * db:reset` part de la racine, donc `DATABASE_PATH=./data/app.db` y désigne
   * `data/app.db` ; le même réglage lu depuis `packages/server/` en désigne un
   * autre.
   *
   * Mesuré le 5 octobre, et c'est le défaut que cette règle garde : `pnpm dev`
   * a créé une SECONDE base, vide, dans `packages/server/data/`, pendant que
   * le seed remplissait celle de la racine. Le joueur se connectait, la table
   * n'était jamais là, et les deux bases étaient parfaitement saines.
   */
  const dev = m.scripts?.['dev'];
  if (dev !== undefined && dev.includes('--env-file') && !dev.startsWith('cd ../..')) {
    soucis.push(
      `packages/${paquet} : le script « dev » lit un .env mais ne part pas de la racine ` +
        `— les chemins relatifs du .env désigneraient alors packages/${paquet}/`,
    );
  }

  if (m.name !== `@for/${paquet}`) {
    soucis.push(
      `packages/${paquet} : le nom devrait être « @for/${paquet} », il est « ${m.name ?? '(absent)'} »`,
    );
  }
  for (const bloc of [m.dependencies, m.devDependencies]) {
    for (const [dep, version] of Object.entries(bloc ?? {})) {
      if (version.startsWith('workspace:')) continue;
      const parDep = versions.get(dep) ?? new Map<string, string[]>();
      parDep.set(version, [...(parDep.get(version) ?? []), paquet]);
      versions.set(dep, parDep);
    }
  }
}

for (const [dep, parVersion] of versions) {
  if (parVersion.size > 1) {
    const detail = [...parVersion].map(([v, qui]) => `${v} (${qui.join(', ')})`).join(' ; ');
    soucis.push(`« ${dep} » est épinglé à plusieurs versions : ${detail}`);
  }
}

if (soucis.length > 0) {
  console.error(`\ncheck:workspace — ${String(soucis.length)} problème(s)\n`);
  for (const s of soucis) console.error(`  ✗ ${s}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check:workspace — ${String(paquets.length)} paquets, ${String(COMMANDES_RACINE.length)} commandes racine : tout est en place.`,
);

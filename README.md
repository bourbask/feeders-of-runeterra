# Feeders of Runeterra

Une table de jeu de rôle multijoueur au Freljord, avec un maître de jeu tenu par une IA.

Le vocal reste sur Discord. Ici, on gère le reste : les personnages, la table, les dés, les
serments, la chronique de campagne, et un conteur qui décrit ce que les dés ont déjà décidé.

## L'invariant qui fait tout tenir

**Le moteur décide, l'IA raconte.** Aucun outil exposé au modèle ne peut modifier une jauge,
trancher une réussite ou tuer un personnage. Le résultat est calculé par le moteur de règles,
puis transmis au conteur comme un fait acquis, à habiller. Un conteur ne peut ni vous sauver,
ni vous condamner.

Trois autres règles d'architecture, non négociables :

- la mémoire vit dans la base, jamais dans la fenêtre de contexte ;
- le serveur est l'autorité, le client n'envoie que des intentions ;
- tout état de partie est rejouable depuis un journal d'événements.

## Démarrer

Node 24 (`.nvmrc`), pnpm 12, rien d'autre. Un conteur n'est pas obligatoire :
`NARRATOR_PROVIDER=stub` fait tourner tout le produit sans clé ni réseau.

```bash
pnpm install
cp .env.example .env     # SESSION_SECRET et les trois variables Discord
pnpm db:reset            # base remise à zéro, campagne de démonstration amorcée
pnpm dev                 # le serveur et la SPA
```

## Les commandes du quotidien

| Commande                          | Ce qu'elle fait                                       |
| --------------------------------- | ----------------------------------------------------- |
| `pnpm verify`                     | la porte de merge locale : si elle passe, la CI passe |
| `pnpm test`                       | tous les paquets                                      |
| `pnpm typecheck`                  | le code de production **seulement**                   |
| `pnpm typecheck:tests`            | les fichiers de test — tâche turbo distincte          |
| `pnpm lint` · `pnpm format`       | style et règles de frontière                          |
| `pnpm depcruise`                  | le graphe de dépendances entre paquets                |
| `pnpm test:coverage`              | la couverture globale et son seuil de 70 %            |
| `pnpm db:reset` · `pnpm db:check` | base réamorcée · les 12 oracles d'intégrité           |
| `pnpm sim run`                    | les 7 scénarios du simulateur de table                |
| `pnpm eval:offline`               | l'éval du conteur, sans clé d'API                     |
| `pnpm eval:smoke --provider=stub` | la sonde de fumée d'un fournisseur                    |
| `pnpm eval:probe --provider=stub` | la mesure complète d'un fournisseur                   |

Et les deux qui prouvent que le socle tient :

| Commande                       | Ce qu'elle prouve                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/smoke-m0.sh`     | installation → migrations → amorçage → serveur → socket authentifiée → `s2c.welcome` + `s2c.snapshot` + `s2c.presence` → `c2s.why` → `s2c.turn_proof` → arrêt propre |
| `bash scripts/canary-regle.sh` | changer **une** constante de règle fait rougir un test unitaire, un corpus doré **et** un scénario du simulateur, en moins de 30 s                                   |

La recette complète — dont la connexion Discord, qui reste une étape manuelle —
est dans `docs/runbook/verification-m0.md`.

## Documentation

- `docs/GLOSSAIRE.md` — **commence ici si un mot t'arrête.** Les jauges, le Souffle, les serments, mais aussi `c2s.intent`, « miroir », « garde-fou », « corpus doré ». Écrit pour être lu sans connaître le code.

- `docs/ARCHITECTURE.md` — le document de référence, à lire en premier
- `docs/design/` — les spécifications de détail
- `docs/M0-TASKS.md` — le découpage du jalon en cours
- `docs/RECETTE.md` — la batterie de sondes à passer avant d'ouvrir une PR
- `docs/runbook/` — exploitation : CI, déploiement, sauvegardes, recette de M0

## Prototype

Une version solo jouable, qui a servi à valider la boucle de jeu :
https://claude.ai/artifact/CUNLVt1WTRMqakvkmoN4WU

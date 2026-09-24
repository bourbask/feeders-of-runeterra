# ADR 0010 — Un numéro de livraison par joueur, et huit arbitrages de cohérence

Statut : **acté** · Date : 24 septembre 2026 · Décideurs : le porteur du projet (décision 1), le tech lead (le reste)
Origine : les neuf contradictions escaladées par la passe de résolution (issue #14).

---

## Décision 1 — un numéro de livraison dense par destinataire

**Le problème.** `ARCHITECTURE.md` §6 garantit que les événements arrivent « dans l'ordre
strict des `seq`, sans trou » — c'est ce qui permet à un client de détecter qu'il a perdu un
message. L'ADR 0008 rend la diffusion adressée : un joueur ne reçoit plus tout, donc sa
numérotation aura des trous normaux. Les deux ne peuvent pas être vrais.

**Option disqualifiée.** Faire tolérer les trous au client : il ne peut alors plus distinguer
« ce n'était pas pour moi » de « je l'ai perdu ». La détection de perte disparaît.

**Décision.** Le serveur maintient, en plus du `seq` global de campagne, un **`deliverySeq`
dense par (campagne, joueur)**, porté par `s2c.event`. La garantie « sans trou » redevient vraie
pour chacun.

| | |
|---|---|
| `seq` | numéro global de campagne, dans le journal, jamais dense pour un destinataire donné |
| `deliverySeq` | numéro de livraison, dense par joueur, dans le message — **pas dans le journal** |
| Reprise | `c2s.resume` porte désormais le `deliverySeq` du joueur, pas le `seq` global |

**Motif du « maintenant » plutôt que du « plus tard »**, dans les mots du décideur : *« si on ne
le fait pas maintenant on va l'oublier au moment où il faudra le faire, et on va se demander
pourquoi on a des incohérences »*. C'est tout ce qui manquait pour que la diffusion adressée
fonctionne.

**Pour M0-08**, qui gèle le protocole : `deliverySeq` entre dans l'enveloppe `s2c`, et
`c2s.resume` change de curseur. Ça ne touche pas le journal — donc pas de migration.

---

## Décisions 2 à 9 — arbitrages de cohérence

| # | Contradiction | Décision | Motif |
|---|---|---|---|
| 2 | `02-mj-ia.md` §0.7 : la règle de neutralité serait rouge sur sa propre table, qui écrit les motifs qu'elle interdit | L'exemption de N1 s'étend à la table de §0.7, symétriquement à N2 qui l'a déjà. La phrase « dont l'unique exemption est le bloc des adaptateurs » est amendée | Une table qui interdit des motifs doit pouvoir les nommer. Un test rouge par construction ne sert personne |
| 3 | `M0-TASKS.md` : la fiche M0-21, absorbée, reste sous le titre « Vague 7 » | Elle sort des vagues, dans une section « Tâches retirées » | Un lecteur qui ouvre « Vague 7 » ne doit pas rencontrer d'abord une tâche qui n'en est pas |
| 4 | `03-donnees.md` §7.1 : le seed pose deux instantanés au même `seq`, que l'index unique interdit | Un seul instantané, `session_end`, au `seq` réel de clôture. Le `rolling` à 180 disparaît | La cadence `rolling` est de 200 événements : celui-là n'aurait jamais dû exister. Le schéma ne bouge pas |
| 5 | `03-donnees.md` : `scope` et `recipients` sont fusionnés dans l'enveloppe mais absents du DDL | Deux colonnes sur `events` : `scope TEXT NOT NULL CHECK (…)` et `recipients_json TEXT` | À sept joueurs, une table d'association est une complexité sans contrepartie |
| 6 | `03-donnees.md` §0.4 : trois tables définies en §1 n'appartiennent à aucune zone | `oauth_states` en zone A ; `chronicle_jobs` et `ai_turn_renders` en zone D, avec mention explicite que `db:rebuild` n'y touche pas | Le cas dur est `ai_turn_renders`, que §1.5 interdit de recalculer : il lui faut une zone qui le dise |
| 7 | `01-architecture.md` : le troisième corpus doré est situé dans un dossier `eval/` que §2.7 déclare inexistant | Il vit dans `packages/ai/tests/golden/`, comme les deux autres | §3.5 veut tous les corpus au même endroit. La cohérence l'emporte sur l'exception |
| 8 | `@for/testkit` : autorisé en dépendance d'exécution d'`@for/ai-eval` par §1.1, interdit par la règle 6 de §1.2 | La règle 6 s'élargit : runtime dans `@for/sim` **et** `@for/ai-eval` | Les runners d'éval consomment fixtures et runner doré à l'exécution. Ouvert depuis l'ADR 0002 |
| 9 | `M0-REVUE.md` : « onze tâches » pour un tableau de onze lignes couvrant dix tâches | Lire « onze critères mous sur dix tâches ». §5 et §0 point 4 corrigés | Le tableau compte des lignes, pas des tâches. Deux d'entre elles y figurent deux fois |

---

## Ce que cette passe a appris sur la méthode

45 contradictions résolues, 33 signalées : les enquêteurs en ont trouvé douze de plus **en
cherchant la preuve des premières**. Chercher pourquoi un chiffre est faux fait rencontrer les
autres chiffres faux.

Et la hiérarchie de preuves a tenu : **le code fusionné tranche**. « Environ soixante-dix »
contre 71 types réellement exportés, « les 19 tables » contre 21 `CREATE TABLE`, une tâche
créditée d'un fichier que `git` attribue à une autre. Aucune de ces questions n'avait besoin
d'un arbitrage humain — seulement de quelqu'un qui va regarder.

Les neuf qui sont remontées ici partagent une propriété : **elles demandent de savoir ce qu'on
veut, pas ce qui est.** C'est la bonne frontière, et elle s'est révélée tenable.

# ADR 0006 — « Payer le prix » n'a qu'un mode, et l'effet `choice` n'est pas une porte dérobée

Statut : **acté** · Date : 21 septembre 2026 · Décideur : tech lead
Concerne : `03-donnees.md` §4.3 (`EffectSchema`), et tout ce qui l'exécutera — M0-05, M0-12, M0-13.

## Ce qui n'allait pas

L'arbitrage P21 énonce, mot pour mot : « Le moteur tire, point final. Personne ne choisit :
ni le modèle, ni le joueur. Il n'existe ni outil de prix, ni `optionId`, ni
`kind: 'price_choice'`, ni `playerChoices`. » J'avais fait retirer l'outil, l'`optionId` et le
mécanisme de proposition.

**Je n'avais pas touché au schéma lui-même.** Quarante lignes plus bas dans le même document,
`EffectSchema` déclarait encore :

```ts
z.object({ op: z.literal('pay_price'),
           mode: z.enum(['roll', 'gm_choice', 'player_choice']) }),
```

L'invariant 1 restait donc ouvert dans le document qui fait autorité, prêt à être implémenté
de bonne foi par la première tâche qui écrirait l'exécuteur d'effets.

Le trou ne s'est pas vu en relisant la spécification — il s'est vu parce que la règle de miroir
obligeait `EngineEffect` à reproduire `EffectSchema` à l'identique, et que le développeur de
M0-02 a **refusé de corriger en silence**. Il a mirroiré la contradiction, l'a signalée dans le
code et l'a remontée. C'était le bon réflexe, et c'est lui qui a rendu le défaut visible.

## La décision

**`pay_price` n'a qu'un mode : `roll`.** Le moteur lance le d12 sur la table des prix et
transmet l'entrée tirée au conteur comme un fait imposé, à intégrer tel quel. `gm_choice` et
`player_choice` sont supprimés du schéma.

Coût du report, s'il avait fallu attendre : M0-05 aurait écrit le schéma Zod, M0-12 l'exécuteur,
et une branche `gm_choice` dans l'exécuteur serait devenue un second chemin d'écriture d'état —
exactement ce que l'invariant 1 existe pour interdire.

## L'effet `choice` survit, et voici pourquoi ce n'est pas une contradiction

`choice` reste dans `EffectSchema`. Un mouvement qui propose « perds des vivres ou encaisse le
coup » est de l'agentivité de joueur ordinaire, et c'est le cœur d'un jeu de rôle. L'invariant 1
porte sur le **modèle**, pas sur le joueur.

Trois bornes le séparent d'une porte dérobée, et elles ne se négocient pas :

1. **`choice` n'est jamais atteignable depuis `pay_price`.** Un prix tiré ne se transforme pas
   en menu. Si les deux se rencontrent un jour dans une définition de contenu, c'est le chargeur
   qui doit refuser le fichier.
2. **Les options viennent du contenu versionné ou du moteur, jamais du modèle.** Le conteur ne
   propose pas d'options : il décrit celles que la table a produites.
3. **La sélection du joueur est une intention ordinaire**, envoyée au serveur et validée par lui
   comme n'importe quelle autre (invariant 3).

## Ce qui reste à faire, et par qui

- **M0-05** écrit `EffectSchema` en Zod à partir de la version corrigée, et ajoute un test qui
  échoue si `pay_price` retrouve un jour plus d'un mode.
- **M0-13 ou M0-12**, selon qui porte l'exécuteur : la borne 1 devient une vérification du
  chargeur de contenu, avec son test négatif.
- **M0-02** : `EngineEffect` mirroire déjà la version contradictoire et porte la remarque dans
  `src/types/effects.ts`. À resserrer quand la branche sera rebasée — le commentaire d'alerte
  peut alors être remplacé par un renvoi vers cet ADR.

## Ce que cet épisode dit de la méthode

Un arbitrage qui retire un mécanisme doit être appliqué **jusqu'au schéma**, pas seulement
jusqu'aux outils et aux messages. Un type est une spécification exécutable : tant qu'il déclare
une possibilité, quelqu'un finira par l'implémenter, et il aura raison de le faire.

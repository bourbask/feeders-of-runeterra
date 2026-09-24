# ADR 0009 — Atouts de perception : des chances, pas des certitudes

Statut : **acté** · Date : 24 septembre 2026 · Décideurs : le porteur du projet et Théo
Amende la décision 2 de l'ADR 0008. Concerne M0-16 (schéma de fiche), M0-13 (moteur), M1 (équilibrage).

## Ce qui change par rapport à l'ADR 0008

L'ADR 0008 disait : les traits sont passifs et **sans jet**, tout le reste se gagne par un
mouvement. Motif de l'époque : pas de jets cachés sur une table sans MJ humain pour arbitrer le
secret.

**Cet argument tombe, parce que le moteur est un arbitre impartial et auditable.** Le jet est
tiré sur un flux nommé, journalisé avec son `rngStream` et son `rngDrawIndex`, rejouable à
l'identique, et consultable après coup. Un MJ humain lance derrière un écran ; le moteur lance
dans un journal.

Les traits deviennent donc **probabilistes**. Braum pressent souvent le danger, pas toujours —
sinon ce n'est plus un atout.

## La forme d'un atout

| Champ | Contenu | Exemple |
|---|---|---|
| `domaine` | de quoi il s'agit | danger · traque · mensonge · froid · blessure |
| `declencheur` | condition sur les faits de scène | « une menace non perçue approche » · « une cible désignée est à distance » |
| `force` | la chance que ça parte sur ce domaine | Braum/danger : forte · Rengar/soin : minuscule |
| `frequence` | combien de fois c'est possible | par scène · par session · par aventure |
| `effet` | ce qui est révélé ou accordé | un fait ajouté à la liste perceptible, ou une capacité ouverte |

**Le déclencheur est la pièce qui évite le ridicule.** Le regard de prédateur de Rengar ne voit
pas « des gens au loin », il voit **des cibles**. Sans ce champ, on obtient un Rengar qui repère
les marchands. Une probabilité seule ne sait pas exprimer ça.

Les atouts sortent du physique du personnage, de son lore, ou de ses mécaniques dans League of
Legends.

## Le principe d'équilibrage

**Un atout qui se déclenche toujours n'est plus un atout, c'est une règle. Un atout qui ne se
déclenche jamais n'existe pas.**

La zone intéressante est étroite et ne se trouve qu'en jouant. D'où deux conséquences :

- les valeurs sont du **contenu versionné**, réglables sans redéploiement ;
- une phase d'équilibrage longue est prévue en M1, et c'est normal.

## L'invariant 1 tient

Le moteur tire, le moteur décide si l'atout part. Le conteur reçoit ensuite « Braum perçoit
ceci » comme un fait acquis. **Le conteur ne décide jamais qu'un atout se déclenche.**

## Visibilité des jets

Le joueur voit les réussites **et** les ratés. Conséquence assumée : un raté annonce qu'il y
avait quelque chose à sentir.

Le détail du jet reste **replié derrière « Pourquoi ? »**, pas dans le fil de narration. Il est
toujours disponible, jamais poussé.

**Pas d'animation de dés.** Point réexaminable en toute fin de projet, sans engagement.

Le raisonnement qui avait été avancé contre — « le résultat est déjà décidé quand l'animation
commence, donc la tension est fausse » — **est faux et a été retiré**. Un dé physique est tout
aussi déterminé dès qu'il quitte la main : la physique a tranché, on regarde le résultat devenir
visible. L'incertitude qui compte est celle du joueur, pas celle du système, et elle est
identique dans les deux cas. La seule différence réelle est qu'au réel le délai est subi et
qu'à l'écran il est choisi — ce qui ne suffit pas à trancher.

## Ce qui reste ouvert

Faut-il montrer le jet **sans dire sur quoi il portait** — « instinct, raté » plutôt que
« danger, raté » ? Cela garderait la transparence voulue tout en préservant une part de
mystère. Non tranché.

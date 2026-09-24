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

## Documentation

- `docs/GLOSSAIRE.md` — **commence ici si un mot t'arrête.** Les jauges, le Souffle, les serments, mais aussi `c2s.intent`, « miroir », « garde-fou », « corpus doré ». Écrit pour être lu sans connaître le code.

- `docs/ARCHITECTURE.md` — le document de référence, à lire en premier
- `docs/design/` — les spécifications de détail
- `docs/M0-TASKS.md` — le découpage du jalon en cours

## Prototype

Une version solo jouable, qui a servi à valider la boucle de jeu :
https://claude.ai/artifact/CUNLVt1WTRMqakvkmoN4WU

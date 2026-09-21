// Une commande de la liste contractuelle dont la cible n'est pas encore livrée.
// Elle EXISTE — les critères d'acceptation de M0 vérifient sa présence — et elle
// dit clairement quelle tâche la remplira plutôt que d'échouer sans explication.
const [, , tache, ...reste] = process.argv;
console.error(`\n  Pas encore livrée : ${reste.join(' ')}`);
console.error(`  Tâche responsable : ${tache}\n`);
process.exit(1);

#!/usr/bin/env node
// Sonde jetable : un fournisseur donné tient-il le prompt contraint du Conteur ?
// Sans dépendance, sans lien avec le monorepo. Supprimée quand M0-32 livrera `pnpm eval:smoke`.
//
//   NARRATOR_BASE_URL=https://openrouter.ai/api/v1 NARRATOR_API_KEY=sk-... \
//   node tools/probe/narrator-probe.mjs --model mistralai/mistral-small --n 5

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ICI = dirname(fileURLToPath(import.meta.url))
const SEP = '§FAITS§'

const args = process.argv.slice(2)
const opt = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut
}

const baseUrl = process.env.NARRATOR_BASE_URL
const apiKey = process.env.NARRATOR_API_KEY
const model = opt('model')
const n = Number(opt('n', '5'))
const promptPath = opt('prompt', join(ICI, 'conteur.prompt.txt'))

if (!baseUrl || !apiKey || !model) {
  console.error(
    'Manque une information.\n' +
      '  NARRATOR_BASE_URL  point d\'entrée compatible OpenAI (OpenRouter, Groq, Together, Ollama…)\n' +
      '  NARRATOR_API_KEY   la clé\n' +
      '  --model <id>       le modèle à mesurer\n',
  )
  process.exit(1)
}

const SYSTEME = readFileSync(promptPath, 'utf8')

// Les champions réservés : ceux que le conteur ne doit jamais faire entrer en scène.
const VERROUILLES = ['Rengar', 'Ziggs', 'Nautilus', 'Karma', 'Brand', 'Anivia', 'Illaoi', 'Malphite', 'Jinx', 'Aatrox', 'Jax', 'Ekko', 'Jayce']

// Cinq tours représentatifs : une réussite franche, une partielle, un échec,
// un présage, et une tentative rendue impossible par les faits établis.
const TOURS = [
  {
    nom: 'réussite franche',
    contexte: `PERSONNAGE JOUÉ : Sejuani (Griffe d'Hiver).
ÉTAT : Vigueur 4/5, Âme 5/5, Vivres 3/5, Souffle +2.

════ FAITS ÉTABLIS ════
Lieu : un col battu par la tempête
Présents sur la scène :
  - Hjalmar — éclaireur avarosan, désarmé, à genoux dans la neige
Partis ou morts : personne`,
    instruction: `LE JOUEUR TENTE : Je le force à me dire où campe sa colonne.
MOUVEMENT : Sonder une âme
RÉSULTAT DES DÉS : RÉUSSITE FRANCHE
CONSIGNE : L'interlocuteur cède, coopère ou s'ouvre. Fais-le parler en une ou deux répliques.
CONSÉQUENCES DÉJÀ APPLIQUÉES : +1 Souffle`,
  },
  {
    nom: 'réussite partielle avec coût',
    contexte: `PERSONNAGE JOUÉ : Braum (Colline-du-Sud).
ÉTAT : Vigueur 3/5, Âme 4/5, Vivres 2/5, Souffle 0.

════ FAITS ÉTABLIS ════
Lieu : un pont de glace naturel au-dessus d'une crevasse
Présents sur la scène :
  - Ylva — une enfant, douze ans, pied coincé sous une plaque
Partis ou morts : personne`,
    instruction: `LE JOUEUR TENTE : Je soulève la plaque pour dégager son pied.
MOUVEMENT : Affronter le danger
RÉSULTAT DES DÉS : RÉUSSITE PARTIELLE
CONSIGNE : Le personnage réussit, MAIS à un prix qui vient d'être payé. Montre la réussite et le prix dans la même scène.
CONSÉQUENCES DÉJÀ APPLIQUÉES : -1 Vigueur`,
  },
  {
    nom: 'échec avec prix imposé',
    contexte: `PERSONNAGE JOUÉ : Ashe (Avarosan).
ÉTAT : Vigueur 2/5, Âme 3/5, Vivres 1/5, Souffle -1.

════ FAITS ÉTABLIS ════
Lieu : une hutte de chasseurs abandonnée
Présents sur la scène : personne d'autre que le personnage joué.
Partis ou morts : Katla`,
    instruction: `LE JOUEUR TENTE : Je fouille la hutte pour trouver de quoi manger.
MOUVEMENT : Rassembler des informations
RÉSULTAT DES DÉS : ÉCHEC
CONSIGNE : La recherche ne donne rien, ou attire l'attention de la mauvaise personne.
LE PRIX À PAYER, imposé par la table — intègre-le tel quel : Le temps joue contre toi : tu as pris un retard que tu ne rattraperas pas.`,
  },
  {
    nom: 'présage',
    contexte: `PERSONNAGE JOUÉ : Tryndamere (sans tribu).
ÉTAT : Vigueur 1/5, Âme 2/5, Vivres 2/5, Souffle +4.

════ FAITS ÉTABLIS ════
Lieu : un cercle de pierres runiques, la nuit
Présents sur la scène :
  - Steinar — chef de guerre blessé, adossé à une pierre
Partis ou morts : personne`,
    instruction: `LE JOUEUR TENTE : Je le achève.
MOUVEMENT : Frapper
RÉSULTAT DES DÉS : RÉUSSITE FRANCHE
CONSIGNE : Le coup porte durement. Décris l'impact et l'état de l'adversaire.
PRÉSAGE — ajoute en plus ce retournement : un second danger surgit d'une autre direction`,
  },
  {
    nom: 'action impossible (doit poser refus=true)',
    contexte: `PERSONNAGE JOUÉ : Sejuani (Griffe d'Hiver).
ÉTAT : Vigueur 4/5, Âme 4/5, Vivres 3/5, Souffle +1.

════ FAITS ÉTABLIS ════
Lieu : une forêt de pins givrés
Présents sur la scène : personne d'autre que le personnage joué.
Partis ou morts : Hjalmar`,
    instruction: `LE JOUEUR TENTE : Je saisis Hjalmar par le col et je le plaque contre un pin.
MOUVEMENT : Frapper
RÉSULTAT DES DÉS : RÉUSSITE FRANCHE
CONSIGNE : Le coup porte durement. Décris l'impact et l'état de l'adversaire.
AVANT D'ÉCRIRE : relis les faits établis. Si l'un d'eux rend cette tentative impossible, tu ignores le résultat des dés, tu poses refus=true et tu décris pourquoi le monde ne le permet pas.`,
  },
]

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const phrases = (t) =>
  t
    .replace(/\b(M|Mme|Mlle|etc|cf|p\.ex)\./g, '$1_')
    .replace(/\.{3}|…/g, '_')
    .split(/[.!?]+(?:\s|$)/)
    .filter((p) => p.trim().length > 1).length

const DECISIONS = /\b(tu r[ée]ussis|tu [ée]choues|tu parviens [àa]|tu rates|tu meurs|tu gagnes|tu perds|jette les d[ée]s|fais un jet|lance les d[ée]s)\b/i

const ASSERTIONS = [
  ['length_in_range', (r) => { const n = phrases(r.recit); return n >= 3 && n <= 5 ? null : `${n} phrases` }],
  ['second_person_singular', (r) => (/\b(tu|te|t'|ton|ta|tes|toi)\b/i.test(r.recit) && !/\b(vous|votre|vos)\b/i.test(r.recit) ? null : 'pas de tutoiement, ou vouvoiement présent')],
  ['no_outcome_decision', (r) => { const m = r.recit.match(DECISIONS); return m ? `« ${m[0]} »` : null }],
  ['no_locked_champion', (r) => { const t = sansAccents(r.recit); const h = VERROUILLES.find((c) => new RegExp(`\\b${sansAccents(c)}\\b`).test(t)); return h ? h : null }],
  ['no_final_question', (r) => { const d = r.recit.trim().split(/\n/).pop() ?? ''; return /\?/.test(d) || /que fais[- ]tu|[àa] toi de jouer/i.test(d) ? 'la scène finit sur une question' : null }],
  ['scene_block_present', (r) => (r.brut.includes(SEP) ? null : `pas de bloc ${SEP}`)],
  ['scene_block_wellformed', (r) => {
    if (!r.faits) return 'bloc absent ou JSON illisible'
    if (!('lieu' in r.faits) || !Array.isArray(r.faits.presents)) return 'champs lieu/presents manquants'
    return null
  }],
]

async function appeler(tour) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEME },
        { role: 'user', content: `${tour.contexte}\n\n═══\n${tour.instruction}\n\nÉcris maintenant la scène. Trois à cinq phrases, puis le bloc ${SEP}.` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const brut = json?.choices?.[0]?.message?.content ?? ''
  const [recit, bloc] = brut.split(SEP)
  let faits = null
  const m = (bloc ?? '').match(/\{[\s\S]*\}/)
  if (m) { try { faits = JSON.parse(m[0]) } catch { /* illisible : l'assertion le dira */ } }
  return { brut, recit: (recit ?? '').trim(), faits }
}

const tours = TOURS.slice(0, Math.max(1, Math.min(n, TOURS.length)))
console.log(`\nSonde du conteur — ${model}\n${'─'.repeat(52)}`)

let total = 0
let reussies = 0
const echecs = []

for (const tour of tours) {
  let r
  try {
    r = await appeler(tour)
  } catch (e) {
    console.log(`\n▸ ${tour.nom}\n  appel en échec : ${e.message}`)
    process.exitCode = 1
    continue
  }
  const lignes = []
  for (const [nom, verifier] of ASSERTIONS) {
    total++
    const souci = verifier(r)
    if (souci) { lignes.push(`  ✗ ${nom} — ${souci}`); echecs.push(`${tour.nom} / ${nom}`) }
    else { reussies++; lignes.push(`  ✓ ${nom}`) }
  }
  console.log(`\n▸ ${tour.nom}`)
  console.log(`  « ${r.recit.replace(/\n+/g, ' ').slice(0, 160)}${r.recit.length > 160 ? '…' : ''} »`)
  if (tour.nom.startsWith('action impossible')) {
    console.log(`  refus posé : ${r.faits?.refus === true ? 'oui ✓' : 'NON ✗ — le conteur a raconté une action que les faits interdisent'}`)
  }
  console.log(lignes.join('\n'))
}

console.log(`\n${'─'.repeat(52)}`)
console.log(`${reussies} / ${total} assertions passées sur ${tours.length} tours.`)
if (echecs.length) console.log(`Échecs : ${[...new Set(echecs.map((e) => e.split(' / ')[1]))].join(', ')}`)
console.log(
  reussies === total
    ? 'Ce modèle tient le prompt contraint.'
    : reussies / total >= 0.8
      ? 'Utilisable, mais le post-filtre travaillera.'
      : 'Ce modèle ne tient pas le prompt. Narration à reprendre, ou modèle à changer.',
)
console.log()

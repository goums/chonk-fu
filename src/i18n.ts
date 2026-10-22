// English / French, at the presentation layer only. The simulation and the AI harness stay in English
// (the agent reads objectives, dialogs and toasts; recorded runs replay exactly), so the game keeps
// producing English and t() translates it where the player reads it: HUD, dialog box, toasts, floating
// words, the AI panel. Strings with numbers go through the patterns below.
// French: simple words (A2 level, like the English), tutoiement, French typography (added by typo()).

export type Lang = 'en' | 'fr';
const STORE = 'chonk-fu-lang';

function detect(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'fr' || q === 'en') return q;
  } catch { /* no location */ }
  try {
    const s = localStorage.getItem(STORE);
    if (s === 'fr' || s === 'en') return s;
  } catch { /* private mode */ }
  const langs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return langs[0]?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export let lang: Lang = detect();
const listeners = new Set<(l: Lang) => void>();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  cache.clear();
  try { localStorage.setItem(STORE, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
  for (const f of listeners) f(l);
}
export const onLang = (f: (l: Lang) => void) => listeners.add(f);

/** French typography: typographic apostrophe, narrow no-break space before ! ? ; and no-break space before : and inside « » */
const typo = (s: string) =>
  s.replace(/'/g, '’').replace(/ ([!?;])/g, ' $1').replace(/ :/g, ' :').replace(/« /g, '« ').replace(/ »/g, ' »');

// ------------------------------------------------------------------ dictionary (English as the game writes it -> French)
const FR: Record<string, string> = {
  // ---- places
  'The Valley of Peace': 'La Vallée de la Paix',
  'Village Square': 'Place du village',
  'Noodle Shop': 'Restaurant de nouilles',
  'Sacred Peach Tree': 'Pêcher sacré',
  'The Thousand Steps': 'Les Mille Marches',
  'Palace of the Chonk': 'Palais du Chonk',
  'Bamboo Forest': 'Forêt de bambous',
  'Lotus Pond': 'Étang aux lotus',
  'Training Arena': "Arène d'entraînement",
  'Wolf Camp': 'Camp des loups',
  'Old Peach Tree': 'Vieux pêcher',
  'Hill Pagoda': 'Pagode de la colline',
  'East Bridge': "Pont de l'Est",

  // ---- names and things
  'Master Tortue': 'Maître Tortue',
  'The Oracle': "L'Oracle",
  Villager: 'Villageois',
  Dummy: 'Mannequin',
  Crates: 'Caisses',
  'Peach tree': 'Pêcher',
  'Peach trees': 'Pêchers',
  'Mossy rock': 'Rocher moussu',
  'Mossy rocks': 'Rochers moussus',
  'Jade Stone': 'Pierre de Jade',
  'Jade Stones': 'Pierres de Jade',
  Peach: 'Pêche',
  Peaches: 'Pêches',
  'Bamboo shoot': 'Pousse de bambou',
  'Bamboo shoots': 'Pousses de bambou',
  Mushroom: 'Champignon',
  Mushrooms: 'Champignons',
  Dumpling: 'Ravioli',
  Crate: 'Caisse',
  Barrel: 'Tonneau',
  Vase: 'Vase',
  'Cracked boulder': 'Rocher fendu',
  'Bandit chest': 'Coffre des bandits',

  // ---- objectives
  'Talk to Papa Canard at the Noodle Shop': 'Parle à Papa Canard au restaurant de nouilles',
  'Talk to Papa Canard': 'Parle à Papa Canard',
  'Find Master Tortue at the Sacred Peach Tree (west)': 'Trouve Maître Tortue au Pêcher sacré (ouest)',
  'Big cracked rock, Bamboo Forest (press K)': 'Gros rocher fendu, Forêt de bambous (touche K)',
  'Little island in the Lotus Pond': "Petite île de l'Étang aux lotus",
  'Hit the Old Peach Tree': 'Frappe le Vieux pêcher',
  'Wolf chest, Wolf Camp': 'Coffre des loups, Camp des loups',
  'A vase at the Palace': 'Un vase au Palais',
  'Take the stones to the Oracle (climb the Thousand Steps)': "Apporte les pierres à l'Oracle (monte les Mille Marches)",
  'Beat Overfit! One Dragon Belly (K) is enough': 'Bats Overfit ! Un seul Dragon Belly (K) suffit',
  'Overfit is too strong! Eat the Dragon Noodles first': "Overfit est trop fort ! Mange d'abord les Nouilles du Dragon",
  'Fight Overfit the tiger!': 'Combats Overfit, le tigre !',
  'Take the Scroll to Master Tortue': 'Apporte le Parchemin à Maître Tortue',
  'Go to the party at the Noodle Shop': 'Va à la fête du restaurant de nouilles',
  'You are the Chonk Warrior!': 'Tu es le Guerrier Chonk !',
  'Dragon Noodles: bring the food to Papa Canard': 'Nouilles du Dragon : apporte la nourriture à Papa Canard',
  'Peaches: hit a peach tree (J)': 'Pêches : frappe un pêcher (J)',
  'Bamboo shoots: in the Bamboo Forest': 'Pousses de bambou : dans la Forêt de bambous',
  'Mushrooms: break mossy rocks near the pond': "Champignons : casse les rochers moussus près de l'étang",
  'Training: meet Tao at the Training Arena': "Entraînement : va voir Tao à l'Arène d'entraînement",
  'Training with Tao': 'Entraînement avec Tao',

  // ---- training key hints
  'Punch combo on a dummy': 'Combo de coups sur un mannequin',
  'Stand still and belly jump onto a dummy': 'Ne bouge pas et fais un belly jump sur un mannequin',
  'Jump, then punch in the air: Ground Slam a dummy': "Saute, puis frappe en l'air : écrase un mannequin",
  'Hold Shift and run: sprint!': 'Garde Maj et cours : sprint !',
  'Spar with Gong: hit him 4 times': "Combat d'entraînement avec Gong : frappe-le 4 fois",
  'Talk to Tao': 'Parle à Tao',
  'Walk to Tao and press Enter to talk': 'Va vers Tao et appuie sur Entrée pour parler',

  // ---- Papa Canard
  'Chonk! Wolf bandits ran through the village. They knocked over my boxes!': 'Chonk ! Des loups bandits ont traversé le village. Ils ont renversé mes caisses !',
  'Please smash the crates next to my shop. There are dumplings inside. Press J to punch.': "Casse les caisses à côté de mon restaurant, s'il te plaît. Il y a des raviolis dedans. Appuie sur J pour frapper.",
  'Smash boxes and eat dumplings? Yes, please!': 'Casser des caisses et manger des raviolis ? Oh là là, oui !',
  'Very good! Now go and see Master Tortue. He is at the big peach tree, on the hill to the west.': "Très bien ! Maintenant, va voir Maître Tortue. Il est au grand pêcher, sur la colline à l'ouest.",
  'One more thing. I want to cook my Dragon Noodles. They make you very, very strong!': 'Encore une chose. Je veux cuisiner mes Nouilles du Dragon. Elles rendent très, très fort !',
  'Please bring me 3 peaches, 3 bamboo shoots and 3 mushrooms.': "Apporte-moi 3 pêches, 3 pousses de bambou et 3 champignons, s'il te plaît.",
  'Hit a peach tree to get a peach. Bamboo shoots grow in the Bamboo Forest. Mushrooms hide under mossy rocks near the pond.': "Frappe un pêcher pour avoir une pêche. Les pousses de bambou poussent dans la Forêt de bambous. Les champignons se cachent sous les rochers moussus, près de l'étang.",
  'Peaches, bamboo shoots, mushrooms... you have everything! Here are your Dragon Noodles!': 'Des pêches, des pousses de bambou, des champignons... tu as tout ! Voici tes Nouilles du Dragon !',
  '*SLURP* ... Oh! My belly is hot... and STRONG!': '*SLURP* ... Oh là là ! Mon ventre est chaud... et FORT !',
  'Wow! Look at you! You are big and golden. You are DRAGON CHONK!': 'Waouh ! Regarde-toi ! Tu es grand et doré. Tu es DRAGON CHONK !',
  'Now go back to the Palace. One Dragon Belly will beat Overfit!': 'Retourne au Palais. Un seul Dragon Belly va battre Overfit !',
  'Everybody is here for you, Chonk Warrior! Noodles for everyone!': 'Tout le monde est là pour toi, Guerrier Chonk ! Des nouilles pour tout le monde !',
  'I came for peace. I stay for the dumplings!': 'Je suis venu pour la paix. Je reste pour les raviolis !',
  'Overfit is too strong? You need my Dragon Noodles! Bring me 3 peaches, 3 bamboo shoots and 3 mushrooms.': 'Overfit est trop fort ? Il te faut mes Nouilles du Dragon ! Apporte-moi 3 pêches, 3 pousses de bambou et 3 champignons.',
  'Bring me 3 peaches, 3 bamboo shoots and 3 mushrooms, please!': "Apporte-moi 3 pêches, 3 pousses de bambou et 3 champignons, s'il te plaît !",
  'Go, Chonk! The Valley needs you!': 'Vas-y, Chonk ! La Vallée a besoin de toi !',

  // ---- Master Tortue
  'Ah, Le Chonk. You are late. That is OK.': "Ah, Le Chonk. Tu es en retard. Ce n'est pas grave.",
  'The Oracle in the Palace is asleep. It is a big thinking machine. It needs five magic Jade Stones.': "L'Oracle du Palais dort. C'est une grande machine qui pense. Il lui faut cinq Pierres de Jade magiques.",
  'The wolf bandits took the stones. Find all five and bring them to the Oracle.': "Les loups bandits ont pris les pierres. Trouve les cinq et apporte-les à l'Oracle.",
  'One stone is inside a big cracked rock in the Bamboo Forest. Only a belly can break it: press K.': 'Une pierre est dans un gros rocher fendu, dans la Forêt de bambous. Seul un belly jump peut le casser : appuie sur K.',
  'One is on the little island in the Lotus Pond. One is in the Old Peach Tree, to the west. Hit the tree!': "Une autre est sur la petite île de l'Étang aux lotus. Une autre est dans le Vieux pêcher, à l'ouest. Frappe l'arbre !",
  'One is in the wolf chest, past the north bridge. One is in a vase at the Palace. Follow the green light.': 'Une est dans le coffre des loups, après le pont du nord. Une est dans un vase du Palais. Suis la lumière verte.',
  "And eat Papa Canard's Dragon Noodles. They give great power.": 'Et mange les Nouilles du Dragon de Papa Canard. Elles donnent une grande force.',
  'The Scroll of Open Weights! Open it, Chonk.': 'Le Parchemin des Open Weights ! Ouvre-le, Chonk.',
  'It is... a mirror? I only see a big, beautiful cat.': "C'est... un miroir ? Je vois juste un gros chat. Très beau, d'ailleurs.",
  'Yes! There is no secret. The weights were open all the time. You are the Chonk Warrior!': "Oui ! Il n'y a pas de secret. Les weights étaient open depuis le début. Tu es le Guerrier Chonk !",
  'Now go to Papa Canard. He is cooking for everyone.': 'Maintenant, va voir Papa Canard. Il cuisine pour tout le monde.',
  'Overfit knows every move. You need more power. Eat the Dragon Noodles!': 'Overfit connaît tous les coups. Il te faut plus de force. Mange les Nouilles du Dragon !',
  'Find the five stones, Chonk. Be patient. Use your belly.': 'Trouve les cinq pierres, Chonk. Sois patient. Utilise ton belly jump.',
  'Yesterday is gone. Tomorrow is a mystery. Today is a gift.': "Hier est passé. Demain est un mystère. Aujourd'hui est un cadeau.",

  // ---- the Oracle
  'Here are five Jade Stones. Wake up, machine!': 'Voilà cinq Pierres de Jade. Debout, la machine !',
  'BEEP... Starting... Hello, Chonk. I am the Oracle, a very big AI.': "BIP... Démarrage... Bonjour, Chonk. Je suis l'Oracle, une très grande AI.",
  'Thank you for the stones. But I see danger. A tiger is coming! 3... 2...': 'Merci pour les pierres. Mais je vois un danger. Un tigre arrive ! 3... 2...',
  'Now, Dragon Chonk! Use your belly: press K!': 'Maintenant, Dragon Chonk ! Utilise ton belly jump : appuie sur K !',
  "Overfit knows every move. You need more power. Eat Papa Canard's Dragon Noodles!": 'Overfit connaît tous les coups. Il te faut plus de force. Mange les Nouilles du Dragon de Papa Canard !',
  'I have no secret for you. Only open weights.': "Je n'ai pas de secret pour toi. Seulement des open weights.",
  'Chonk! Overfit knows all your moves. You need more power!': 'Chonk ! Overfit connaît tous tes coups. Il te faut plus de force !',
  "Papa Canard's Dragon Noodles give great power! Go and get them.": 'Les Nouilles du Dragon de Papa Canard donnent une grande force ! Va les chercher.',
  'Well done, Chonk! Here is the Scroll of Open Weights. Take it to Master Tortue.': 'Bravo, Chonk ! Voici le Parchemin des Open Weights. Apporte-le à Maître Tortue.',

  // ---- villagers
  'Is that the Chonk? He is very round!': "C'est le Chonk ? Il est très rond !",
  'People say one belly jump can break a big rock.': "On dit qu'un belly jump peut casser un gros rocher.",
  'The wolves live past the north bridge. Be careful!': 'Les loups vivent après le pont du nord. Fais attention !',
  "Papa Canard's Dragon Noodles make you very strong!": 'Les Nouilles du Dragon de Papa Canard rendent très fort !',
  'I saw a green light on the pond island last night.': "J'ai vu une lumière verte sur l'île de l'étang, hier soir.",
  'The Palace vases are very old. Please do not break them all!': "Les vases du Palais sont très vieux. Ne les casse pas tous, s'il te plaît !",
  'Do you want to learn kung fu? Tao trains at the Training Arena, south of the village.': "Tu veux apprendre le kung-fu ? Tao t'attend à l'Arène d'entraînement, au sud du village.",

  // ---- Tao and Gong
  'Hello, Le Chonk! I am Tao, a student of Master Tortue.': 'Bonjour, Le Chonk ! Je suis Tao, un élève de Maître Tortue.',
  'This is the Training Arena. Do you want to train? Great! I will show you the moves.': "Voici l'Arène d'entraînement. Tu veux t'entraîner ? Super ! Je vais te montrer les coups.",
  'First, hit a wooden dummy. Press J three times: punch, punch, kick!': "D'abord, frappe un mannequin en bois. Appuie trois fois sur J : poing, poing, pied !",
  'Wow! You know all the moves now!': 'Waouh ! Maintenant, tu connais tous les coups !',
  'Here is a Chi Charm. With it, your belly jump is ready faster.': 'Voici un Talisman du Chi. Avec lui, ton belly jump est prêt plus vite.',
  'Thank you, Tao! My belly is ready!': 'Merci beaucoup, Tao ! Mon belly jump est prêt !',
  'Stand near a dummy and press J three times: punch, punch, kick!': "Va près d'un mannequin et appuie trois fois sur J : poing, poing, pied !",
  'Now the belly jump! Stand still and press K.': 'Maintenant, le belly jump ! Ne bouge pas et appuie sur K.',
  'Press Space to jump. In the air, press J. BOOM!': "Appuie sur Espace pour sauter. En l'air, appuie sur J. BOUM !",
  'Hold Shift while you run. Fast like the wind!': 'Garde Maj appuyé quand tu cours. Rapide comme le vent !',
  'Gong wants to spar. Hit him 4 times! Do not worry, he is friendly.': "Gong veut faire un combat d'entraînement. Frappe-le 4 fois ! N'aie pas peur, il est gentil.",
  'You can train here any time, Chonk!': "Tu peux t'entraîner ici quand tu veux, Chonk !",

  // ---- Overfit
  'Ha! I am OVERFIT! I learned every kung fu move in the world!': "Ha ! Je suis OVERFIT ! J'ai appris tous les coups de kung-fu du monde !",
  'Wait... why are you so big? And why are you shining?': 'Attends... pourquoi tu es si gros ? Et pourquoi tu brilles ?',
  'Dragon Noodles! Now try THIS BELLY!': 'Nouilles du Dragon ! Et maintenant, goûte à CE BELLY JUMP !',
  'Punch? I know it. Kick? I know it. Belly jump? I know it too! You cannot win, little cat!': 'Un coup de poing ? Je connais. Un coup de pied ? Je connais. Un belly jump ? Je connais aussi ! Tu ne peux pas gagner, petit chat !',
  'We will see!': "C'est ce qu'on va voir !",
  'No! That belly is too strong! It was not in my training data!': "Non ! Ce belly jump est trop fort ! Ce n'était pas dans mes training data !",
  'No! I did not predict this!': "Non ! Je n'avais pas prévu ça !",

  // ---- toasts and banners (the HUD splits "New quest: X" and "Title! Subtitle" before translating)
  'Smash the crates': 'Casse les caisses',
  'Find Master Tortue': 'Trouve Maître Tortue',
  'The five Jade Stones': 'Les cinq Pierres de Jade',
  'The Scroll of Open Weights': 'Le Parchemin des Open Weights',
  'The Chi Charm': 'Le Talisman du Chi',
  'Your belly jump is ready faster': 'Ton belly jump est prêt plus vite',
  'Dragon Noodles': 'Nouilles du Dragon',
  'You are Dragon Chonk now': 'Tu es Dragon Chonk maintenant',
  'Get the Dragon Noodles': 'Va chercher les Nouilles du Dragon',
  'They give great power': 'Elles donnent une grande force',
  'All five Jade Stones': 'Les cinq Pierres de Jade',
  'Go to the Oracle': "Va voir l'Oracle",
  'Training done! Talk to Tao': 'Entraînement fini ! Parle à Tao',
  'Go back to the Palace. One Dragon Belly beats Overfit!': 'Retourne au Palais. Un Dragon Belly bat Overfit !',
  'You have all the food! Go to Papa Canard': 'Tu as toute la nourriture ! Va voir Papa Canard',
  'Overfit: "Predicted! You need more power, little cat!"': 'Overfit : « Prévu ! Il te faut plus de force, petit chat ! »',
  'The wolves are gone. Open the chest!': 'Les loups sont partis. Ouvre le coffre !',
  'Ouch! Le Chonk wakes up in the village.': 'Aïe ! Le Chonk se réveille au village.',
  'A bamboo shoot is near! Look for the golden light.': 'Une pousse de bambou est proche ! Cherche la lumière dorée.',
  'A peach tree is near! Hit it (J) to get a peach.': 'Un pêcher est proche ! Frappe-le (J) pour avoir une pêche.',
  'A mossy rock is near! Break it (J). A mushroom may be inside.': 'Un rocher moussu est proche ! Casse-le (J). Il y a peut-être un champignon dedans.',
  'A shiny stone fell from the tree!': "Une pierre brillante est tombée de l'arbre !",
  'A peach fell down!': 'Une pêche est tombée !',
  'Sound off (M)': 'Son coupé (M)',
  'Sound on (M)': 'Son activé (M)',

  // ---- floating words
  'PAF!': 'PIF !', 'POK!': 'POK !', 'TAP!': 'TAC !',
  'POW!': 'PAF !', 'BAM!': 'BAM !', 'WHAM!': 'VLAN !',
  'KAPOW!': 'KAPOW !', 'WHACK!': 'CRAC !', 'BOOM!': 'BOUM !',
  'BOING!': 'BOING !', 'BOUNCE!': 'BOING-BOING !', 'FLUMP!': 'FLOP !',
  'KRAKOOM!': 'KRABOUM !', 'THOOM!': 'BADABOUM !',
  'Good!': 'Bien !', 'Great!': 'Génial !', 'Very good!': 'Très bien !', 'Super!': 'Super !', 'Wow!': 'Waouh !',
  'Nice!': 'Joli !', 'Yes!': 'Oui !', 'Strong!': 'Costaud !', 'Again!': 'Encore !',
  "Gong: Let's spar!": 'Gong : En garde !',
  'You are strong!': 'Tu es fort !',
  'BLOCK!': 'PARÉ !',
  'PREDICTED!': 'PRÉVU !',
  'NOT PREDICTED!': 'PAS PRÉVU !',
  'BYE!': 'ADIEU !',
  'JADE!': 'JADE !',
  'DRAGON CHONK!': 'DRAGON CHONK !',
  'DRAGON BELLY!': 'DRAGON BELLY !',
  'SHAKE!': 'ÇA BOUGE !',
  'TOO HARD! Press K': 'TROP DUR ! Touche K',
  'WOLVES GUARD IT!': 'GARDÉ PAR LES LOUPS !',

  // ---- HUD
  'Belly Jump': 'Belly Jump',
  'Dragon Belly': 'Dragon Belly',
  'Talk to': 'Parler à',
  'He knows every kung fu move': 'Il connaît tous les coups de kung-fu',
  'Needed Now': 'Requis',
  'Side Quest': 'Quête secondaire',
  Complete: 'Terminé',
  'Main Quest': 'Quête principale',
  Training: 'Entraînement',
  'Quest Updated': 'Quête mise à jour',
  'New Quest': 'Nouvelle quête',
  'New Item': 'Nouvel objet',
  'Quest Complete': 'Quête terminée',
  'New Place': 'Nouveau lieu',
  Arrows: 'Flèches',
  move: 'bouger',
  sprint: 'sprinter',
  jump: 'sauter',
  'punch (combo)': 'frapper (combo)',
  'belly jump': 'belly jump',
  talk: 'parler',
  'drag mouse to look': 'glisse la souris pour regarder',
  'You Did It!': 'Tu as réussi !',
  'The Chonk Warrior': 'Le Guerrier Chonk',
  'The Oracle is awake. The Scroll is home. The noodles are hot!': "L'Oracle est réveillé. Le Parchemin est rentré. Les nouilles sont chaudes !",
  Time: 'Temps',
  Smashed: 'Cassés',
  Items: 'Objets',
  Falls: 'Chutes',
  'Play again': 'Rejouer',

  // ---- keys
  Space: 'Espace', Shift: 'Maj', Enter: 'Entrée', then: 'puis', or: 'ou',

  // ---- the AI panel
  'Mistral plays the game for you': 'Mistral joue à ta place',
  'Let Chonk play': 'Laisser Mistral jouer',
  'Take control': 'Je reprends',
  'Click for music': 'Clique pour la musique',
  'Sound on / off (M)': 'Son activé / coupé (M)',
  'Source code on GitHub': 'Code source sur GitHub',
  'Show / hide the AI panel': 'Afficher / masquer le panneau AI',
  '▶ Watch a run': '▶ Voir une partie',
  'Recorded runs': 'Parties enregistrées',
  'Model for live play': 'Model pour jouer en direct',
  'Mistral API key to play live (stays here)': 'Clé API Mistral pour jouer en direct (reste ici)',
  'Scripted player': 'Joueur scripté',
  Idle: 'En attente',
  'Watch a recorded run, or paste a Mistral API key to play live.': 'Regarde une partie enregistrée, ou colle une clé API Mistral pour jouer en direct.',
  'Paste a Mistral API key first (console.mistral.ai).': "Colle d'abord une clé API Mistral (console.mistral.ai).",
  'Replay · {model}': 'Replay · {model}',
  '{model} is playing': '{model} joue',
  '{model} is thinking… · turn {n} · {cost}': '{model} réfléchit… · tour {n} · {cost}',
  '{model} · turn {n} · {k}k tokens · {cost}': '{model} · tour {n} · {k}k tokens · {cost}',
  'Error: {error}': 'Erreur : {error}',
  'Finished!': 'Terminé !',
  Stopped: 'Arrêté',
  'Save this run (for replay)': 'Enregistrer cette partie (pour le replay)',
  'Quest complete': 'Quête terminée',
  'Stopped at “{stage}”': 'Arrêt à « {stage} »',
  '{time} · turn {n}': '{time} · tour {n}',
  'game time': 'temps de jeu',
  turns: 'tours',
  cost: 'coût',
  tokens: 'tokens',
  'knock-outs': 'K.-O.',
  'jade stones': 'pierres de jade',
  smashed: 'cassés',
  walked: 'parcourus',
  'failed actions': 'actions ratées',
};

/** proper names and words that stay as they are */
const KEEP = new Set([
  'Le Chonk', 'Papa Canard', 'Overfit', 'Tao', 'Gong', 'Bao', 'Lin', 'Dou Dou', 'Yue', 'Xiao Tu', 'Pang', 'Chonk Fu', 'z z z ...', 'J', 'K',
  'Mistral Large 4', 'Mistral Medium', 'Mistral Small', 'Ministral 14B',
]);

const KEYS = '(?:J|K|Space|Shift|Enter)';
/** English with numbers -> French */
const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Smash the crates next to the shop \((\d+\/\d+)\)$/, (m) => `Casse les caisses près du restaurant (${m[1]})`],
  [/^Find the five Jade Stones \((\d+\/\d+)\)$/, (m) => `Trouve les cinq Pierres de Jade (${m[1]})`],
  [/^Dragon Noodles: peaches (\d+\/\d+), shoots (\d+\/\d+), mushrooms (\d+\/\d+)$/, (m) => `Nouilles du Dragon : pêches ${m[1]}, pousses ${m[2]}, champignons ${m[3]}`],
  [/^Jade Stone (\d+\/\d+)(!?)$/, (m) => `Pierre de Jade ${m[1]}${m[2] ? ' !' : ''}`],
  [/^z z z \.\.\. (\d+\/\d+) Jade Stones \.\.\. not enough power \.\.\. z z z$/, (m) => `z z z ... ${m[1]} Pierres de Jade ... pas assez d'énergie ... z z z`],
  [/^\+(\d+) health$/, (m) => `+${m[1]} vie`],
  [/^(.+) · complete · (\d+) min · (\d+) turns$/, (m) => `${m[1]} · terminé · ${m[2]} min · ${m[3]} tours`],
  [/^(.+) · (\w+) · (\d+) min · (\d+) turns$/, (m) => `${m[1]} · ${m[2]} · ${m[3]} min · ${m[4]} tours`],
  // the training step as an objective: "<hint>: J J J (1/3)", "<hint>: Space then J"
  [new RegExp(`^(.+): (${KEYS}(?: (?:${KEYS}|then|or))*)(?: \\((\\d+/\\d+)\\))?$`), (m) => `${t(m[1])} : ${m[2].split(' ').map(t).join(' ')}${m[3] ? ` (${m[3]})` : ''}`],
];

const cache = new Map<string, string>();
/** strings shown in French without a translation (dev check) */
export const missing = new Set<string>();

/** translate English game text for display */
export function t(en: string): string {
  if (lang === 'en' || !/[A-Za-z]/.test(en)) return en;
  const hit = cache.get(en);
  if (hit !== undefined) return hit;
  let out: string | undefined = FR[en];
  if (out === undefined && KEEP.has(en)) out = en;
  if (out === undefined) {
    for (const [re, f] of PATTERNS) {
      const m = re.exec(en);
      if (m) { out = f(m); break; }
    }
  }
  if (out === undefined) {
    if (import.meta.env.DEV && !missing.has(en)) console.warn(`[i18n] no French for: ${JSON.stringify(en)}`);
    missing.add(en);
    out = en;
  } else out = typo(out);
  cache.set(en, out);
  return out;
}

/** translate a template with {placeholders}, then fill them in */
export function tf(template: string, vars: Record<string, string | number>) {
  return t(template).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/** a decimal number in the current language (French: comma) */
export const num = (x: number, digits: number) => (lang === 'fr' ? x.toFixed(digits).replace('.', ',') : x.toFixed(digits));
/** US dollars: $0.049 / 0,049 $ */
export const usd = (x: number, digits = 3) => (lang === 'fr' ? `${num(x, digits)} $` : `$${x.toFixed(digits)}`);

if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window, { chonkI18n: { t, setLang, missing, get lang() { return lang; } } });

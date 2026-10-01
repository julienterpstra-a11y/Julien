// Standaard categorisatieregels voor Nederlandse transacties.
// `match` is een reguliere expressie (hoofdletterongevoelig) op tegenpartij + omschrijving.
// `sign` beperkt een regel tot inkomsten ('in') of uitgaven ('out').
export const DEFAULT_RULES = [
  { match: 'salaris|loon|salary|payroll|werkgever', category: 'Salaris', sign: 'in' },
  { match: 'belastingdienst.*(toeslag|teruggaaf)|zorgtoeslag|huurtoeslag|kinderbijslag|svb', category: 'Toeslagen & uitkeringen', sign: 'in' },
  { match: 'spaarrekening|spaar|sparen|eigen rekening|oranje spaar|bunq savings|beleggen|degiro|meesman|brand new day|trade republic', category: 'Sparen & beleggen' },
  { match: 'albert heijn|\\bah\\b|ah to go|jumbo|lidl|aldi|plus\\b|dirk|coop|spar\\b|picnic|vomar|hoogvliet|ekoplaza|crisp', category: 'Boodschappen' },
  { match: 'huur|hypotheek|woningcorporatie|vve|woonbron|ymere|eigen haard', category: 'Wonen' },
  { match: 'eneco|vattenfall|essent|greenchoice|budget energie|vandebron|waternet|vitens|evides|brabant water|dunea|pwn|energie', category: 'Energie & water' },
  { match: 'ziggo|kpn|t-mobile|odido|vodafone|tele2|simyo|ben\\b|lebara|youfone|delta fiber', category: 'Internet & telefoon' },
  { match: 'zilveren kruis|cz\\b|vgz|menzis|ohra|dsw|zorgverzekering|centraal beheer|interpolis|nationale nederlanden|allianz|a\\.s\\.r|asr|univé|unive|fbto|anwb verzekering|verzekering', category: 'Verzekeringen' },
  { match: 'gemeente|waterschap|belastingdienst|cjib|rdw', category: 'Belastingen & overheid' },
  { match: 'ns groep|ns reizigers|\\bns\\b|ov-chipkaart|translink|gvb|ret\\b|htm|arriva|qbuzz|connexxion|shell|bp\\b|esso|tango|tinq|texaco|total|parkeren|q-park|parkmobile|yellowbrick|anwb|swapfiets|uber|bolt', category: 'Vervoer' },
  { match: 'thuisbezorgd|uber eats|deliveroo|restaurant|cafe|café|mcdonald|burger king|kfc|starbucks|bakker|eetcafe|brasserie|pizza|sushi|domino', category: 'Uit eten & horeca' },
  { match: 'netflix|spotify|disney|videoland|hbo|viaplay|youtube|apple\\.com|icloud|google \\*|microsoft|adobe|chatgpt|openai|anthropic|claude', category: 'Abonnementen' },
  { match: 'bol\\.com|coolblue|amazon|zalando|mediamarkt|ikea|hema|action|kruidvat|etos|wehkamp|primark|h&m|blokker|praxis|gamma|karwei|hornbach', category: 'Winkelen' },
  { match: 'apotheek|huisarts|tandarts|fysio|ziekenhuis|trekpleister|da drogist', category: 'Gezondheid' },
  { match: 'sportschool|basic-fit|basic fit|trainmore|fit for free|sportcity|bioscoop|pathe|pathé|vue\\b|museum|ticketmaster|eventim', category: 'Vrije tijd & sport' },
  { match: 'booking\\.com|airbnb|klm|transavia|ryanair|easyjet|tui|corendon|hotel', category: 'Reizen' },
  { match: 'geldautomaat|geldopname|atm|cash', category: 'Contant geld' },
  { match: 'tikkie|betaalverzoek', category: 'Tikkies & terugbetalingen' },
];

// Categorieën die geen echte inkomsten/uitgaven zijn (geld blijft van jou).
export const TRANSFER_CATEGORIES = new Set(['Sparen & beleggen', 'Overboeking eigen rekening']);

const compiled = new Map();
function re(pattern) {
  if (!compiled.has(pattern)) {
    try {
      compiled.set(pattern, new RegExp(pattern, 'i'));
    } catch {
      compiled.set(pattern, null);
    }
  }
  return compiled.get(pattern);
}

export function categorize(tx, rules) {
  const text = `${tx.counterparty || ''} ${tx.description || ''}`;
  for (const rule of rules) {
    if (rule.sign === 'in' && tx.amount < 0) continue;
    if (rule.sign === 'out' && tx.amount > 0) continue;
    if (re(rule.match)?.test(text)) return rule.category;
  }
  return tx.amount > 0 ? 'Overige inkomsten' : 'Overige uitgaven';
}

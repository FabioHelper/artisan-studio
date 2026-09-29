// Human-authored mapping from Macrofy food classes to rows of the bundled source tables (T-005).
// It contains NO nutrient or density numbers: every number is read from the vendored extracts in
// ../data by build_vocab.mjs, so nothing here can be "approximated from memory".
//
//   nutrients: { db: 'TACO', id }        row number of TACO 4th ed. (Brazil), per 100 g edible portion
//              { db: 'FNDDS', code }     FNDDS 2019-2020 food code (used only where TACO has no cooked/prepared row)
//   density:   { code, portion, match }  FNDDS food code + the exact portion description whose gram weight is
//                                        divided by 236.6 mL; match is 'exact' (same food) or 'analog' (closest
//                                        FNDDS food, flagged in vocab.json and listed in the spec)
//   oil:       { with, without }         FNDDS pair (same food made with oil / with no added fat); the fat
//                                        difference per 100 g becomes the default oil (an assumption, flagged)
//   recipe:    ingredients of other classes with grams; nutrients are computed, never typed

export const CUP_ML = 236.6;

export const CLASSES = [
  // ---- rice, pasta, tubers
  { id: 'arroz-branco-cozido', pt: 'arroz branco cozido', en: 'cooked white rice', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 3 }, density: { code: '56205008', portion: '1 cup, cooked', match: 'exact' },
    oil: { with: '56205002', without: '56205008', why: 'Brazilian rice is usually sauteed in oil before boiling; TACO cooks it with no added ingredient' } },
  { id: 'arroz-integral-cozido', pt: 'arroz integral cozido', en: 'cooked brown rice', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 1 }, density: { code: '56205018', portion: '1 cup, cooked', match: 'exact' },
    oil: { with: '56205012', without: '56205018', why: 'same as white rice: TACO cooks it with no added ingredient' } },
  { id: 'macarrao-cozido', pt: 'macarrão cozido', en: 'cooked pasta', state: 'cooked', method: 'boiled',
    nutrients: { db: 'FNDDS', code: '56130000' }, density: { code: '56130000', portion: '1 cup, cooked', match: 'exact' } },
  { id: 'macarrao-molho-bolonhesa', pt: 'macarrão ao molho bolonhesa', en: 'spaghetti with meat sauce', state: 'cooked', method: 'mixed',
    nutrients: { db: 'TACO', id: 542 }, density: { code: '58146120', portion: '1 cup', match: 'analog' } },
  { id: 'lasanha-de-carne', pt: 'lasanha de carne', en: 'meat lasagna', state: 'cooked', method: 'baked',
    nutrients: { db: 'FNDDS', code: '58130011' }, density: { code: '58130011', portion: '1 cup', match: 'exact' } },
  { id: 'nhoque-de-batata', pt: 'nhoque de batata', en: 'potato gnocchi', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 136 }, density: { code: '58122220', portion: '1 cup', match: 'exact' } },
  { id: 'pure-de-batata', pt: 'purê de batata', en: 'mashed potato', state: 'cooked', method: 'boiled',
    nutrients: { db: 'FNDDS', code: '71501010' }, density: { code: '71501010', portion: '1 cup', match: 'exact' } },
  { id: 'batata-cozida', pt: 'batata cozida', en: 'boiled potato', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 91 }, density: { code: '71103010', portion: '1 cup', match: 'exact' } },
  { id: 'batata-frita', pt: 'batata frita', en: 'french fries', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 93 }, density: { code: '71401010', portion: '1 cup', match: 'exact' } },
  { id: 'batata-doce-cozida', pt: 'batata-doce cozida', en: 'boiled sweet potato', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 88 }, density: { code: '73405010', portion: '1 cup, mashed', match: 'exact' } },
  { id: 'mandioca-cozida', pt: 'mandioca cozida', en: 'boiled cassava', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 129 }, density: { code: '71930120', portion: '1 cup', match: 'exact' } },
  { id: 'polenta-cozida', pt: 'polenta', en: 'polenta (cooked cornmeal)', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 62 }, density: { code: '56201516', portion: '1 cup, cooked', match: 'analog' } },
  { id: 'milho-verde-cozido', pt: 'milho verde cozido', en: 'boiled sweet corn', state: 'cooked', method: 'boiled',
    nutrients: { db: 'FNDDS', code: '75216111' }, density: { code: '75216111', portion: '1 cup', match: 'exact' } },

  // ---- beans and pulses
  { id: 'feijao-carioca-cozido', pt: 'feijão carioca cozido', en: 'cooked carioca beans', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 561 }, density: { code: '41104020', portion: '1 cup', match: 'analog' } },
  { id: 'feijao-preto-cozido', pt: 'feijão preto cozido', en: 'cooked black beans', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 567 }, density: { code: '41102020', portion: '1 cup', match: 'exact' } },
  { id: 'lentilha-cozida', pt: 'lentilha cozida', en: 'cooked lentils', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 577 }, density: { code: '41305000', portion: '1 cup', match: 'exact' } },
  { id: 'grao-de-bico-cozido', pt: 'grão-de-bico cozido', en: 'cooked chickpeas', state: 'cooked', method: 'boiled',
    nutrients: { db: 'FNDDS', code: '41302020' }, density: { code: '41302020', portion: '1 cup', match: 'exact' } },

  // ---- mixed dishes (real table rows)
  { id: 'feijoada', pt: 'feijoada', en: 'feijoada (black bean and pork stew)', state: 'cooked', method: 'stewed',
    nutrients: { db: 'TACO', id: 540 }, density: { code: '41102170', portion: '1 cup', match: 'analog' } },
  { id: 'estrogonofe-de-carne', pt: 'estrogonofe de carne', en: 'beef stroganoff', state: 'cooked', method: 'mixed',
    nutrients: { db: 'TACO', id: 537 }, density: { code: '27113100', portion: '1 cup', match: 'exact' } },
  { id: 'estrogonofe-de-frango', pt: 'estrogonofe de frango', en: 'chicken stroganoff', state: 'cooked', method: 'mixed',
    nutrients: { db: 'TACO', id: 538 }, density: { code: '27113100', portion: '1 cup', match: 'analog' } },

  // ---- beef, pork, poultry
  { id: 'bife-grelhado', pt: 'bife grelhado', en: 'grilled beef steak', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 346 }, density: { code: '21102180', portion: '1 cup', match: 'exact' } },
  { id: 'file-mignon-grelhado', pt: 'filé mignon grelhado', en: 'grilled beef tenderloin', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 358 }, density: { code: '21103180', portion: '1 cup', match: 'exact' } },
  { id: 'picanha-grelhada', pt: 'picanha grelhada', en: 'grilled picanha (rump cap)', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 383 }, density: { code: '21102150', portion: '1 cup', match: 'analog' } },
  { id: 'alcatra-grelhada', pt: 'alcatra grelhada', en: 'grilled top sirloin', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 370 }, density: { code: '21102150', portion: '1 cup', match: 'exact' } },
  { id: 'hamburguer-grelhado', pt: 'hambúrguer grelhado', en: 'grilled beef burger patty', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 417 }, density: { code: '21500310', portion: '1 cup', match: 'analog' } },
  { id: 'carne-moida-cozida', pt: 'carne moída', en: 'cooked ground beef', state: 'cooked', method: 'stewed',
    nutrients: { db: 'TACO', id: 326 }, density: { code: '21500100', portion: '1 cup', match: 'exact' } },
  { id: 'carne-cozida-musculo', pt: 'carne cozida (músculo)', en: 'boiled beef shank', state: 'cooked', method: 'stewed',
    nutrients: { db: 'TACO', id: 371 }, density: { code: '21410000', portion: '1 cup', match: 'analog' } },
  { id: 'linguica-de-porco-grelhada', pt: 'linguiça de porco grelhada', en: 'grilled pork sausage', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 423 }, density: { code: '25221405', portion: '1 cup, NFS', match: 'exact' } },
  { id: 'bisteca-de-porco-grelhada', pt: 'bisteca de porco grelhada', en: 'grilled pork chop', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 429 }, density: { code: '22101000', portion: '1 cup', match: 'exact' } },
  { id: 'lombo-de-porco-assado', pt: 'lombo de porco assado', en: 'roast pork loin', state: 'cooked', method: 'baked',
    nutrients: { db: 'TACO', id: 432 }, density: { code: '22400100', portion: '1 cup', match: 'analog' } },
  { id: 'pernil-de-porco-assado', pt: 'pernil de porco assado', en: 'roast pork leg', state: 'cooked', method: 'baked',
    nutrients: { db: 'TACO', id: 435 }, density: { code: '22400100', portion: '1 cup', match: 'analog' } },
  { id: 'frango-grelhado', pt: 'frango grelhado', en: 'grilled chicken breast', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 410 }, density: { code: '24123301', portion: '1 cup, cooked, diced', match: 'exact' } },
  { id: 'frango-coxa-assada', pt: 'coxa de frango assada', en: 'roast chicken drumstick', state: 'cooked', method: 'baked',
    nutrients: { db: 'TACO', id: 396 }, density: { code: '24142300', portion: '1 cup, cooked, diced', match: 'exact' } },
  { id: 'frango-a-milanesa', pt: 'frango à milanesa', en: 'breaded fried chicken fillet', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 401 }, density: { code: '24127202', portion: '1 cup, cooked, diced', match: 'exact' } },

  // ---- fish, seafood, eggs
  { id: 'tilapia-grelhada', pt: 'tilápia grelhada', en: 'grilled tilapia', state: 'cooked', method: 'grilled',
    nutrients: { db: 'FNDDS', code: '26158013' }, density: { code: '26158013', portion: '1 cup', match: 'exact' } },
  { id: 'salmao-grelhado', pt: 'salmão grelhado', en: 'grilled salmon', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 317 }, density: { code: '26137123', portion: '1 cup', match: 'exact' } },
  { id: 'peixe-grelhado', pt: 'peixe grelhado', en: 'grilled fish fillet', state: 'cooked', method: 'grilled',
    nutrients: { db: 'TACO', id: 313 }, density: { code: '26100120', portion: '1 cup', match: 'analog' } },
  { id: 'peixe-frito', pt: 'peixe frito', en: 'fried fish fillet', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 303 }, density: { code: '26100140', portion: '1 cup', match: 'analog' } },
  { id: 'camarao-cozido', pt: 'camarão cozido', en: 'boiled shrimp', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 284 }, density: { code: '26319130', portion: '1 cup', match: 'exact' } },
  { id: 'ovo-frito', pt: 'ovo frito', en: 'fried egg', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 490 }, density: { code: '31105030', portion: '1 cup', match: 'exact' } },
  { id: 'ovo-cozido', pt: 'ovo cozido', en: 'hard-boiled egg', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 488 }, density: { code: '31103010', portion: '1 cup', match: 'exact' } },

  // ---- vegetables and salads
  { id: 'alface-crua', pt: 'alface', en: 'lettuce', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 78 }, density: { code: '75113000', portion: '1 cup', match: 'exact' } },
  { id: 'tomate-cru', pt: 'tomate fatiado', en: 'sliced raw tomato', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 161 }, density: { code: '74101000', portion: '1 cup', match: 'exact' } },
  { id: 'cenoura-crua', pt: 'cenoura crua', en: 'raw carrot', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 110 }, density: { code: '73101010', portion: '1 cup', match: 'exact' } },
  { id: 'pepino-cru', pt: 'pepino', en: 'cucumber', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 142 }, density: { code: '75111000', portion: '1 cup', match: 'exact' } },
  { id: 'cebola-crua', pt: 'cebola crua', en: 'raw onion', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 107 }, density: { code: '75117020', portion: '1 cup', match: 'exact' } },
  { id: 'repolho-cru', pt: 'repolho cru', en: 'raw cabbage', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 149 }, density: { code: '75103000', portion: '1 cup', match: 'exact' } },
  { id: 'cenoura-cozida', pt: 'cenoura cozida', en: 'boiled carrot', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 109 }, density: { code: '73102211', portion: '1 cup', match: 'exact' } },
  { id: 'brocolis-cozido', pt: 'brócolis cozido', en: 'boiled broccoli', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 100 }, density: { code: '72201211', portion: '1 cup', match: 'exact' } },
  { id: 'couve-flor-cozida', pt: 'couve-flor cozida', en: 'boiled cauliflower', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 118 }, density: { code: '75214011', portion: '1 cup', match: 'exact' } },
  { id: 'beterraba-cozida', pt: 'beterraba cozida', en: 'boiled beetroot', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 97 }, density: { code: '75208011', portion: '1 cup', match: 'exact' } },
  { id: 'chuchu-cozido', pt: 'chuchu cozido', en: 'boiled chayote', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 112 }, density: { code: '75233011', portion: '1 cup', match: 'analog' } },
  { id: 'abobora-cozida', pt: 'abóbora cozida', en: 'boiled pumpkin', state: 'cooked', method: 'boiled',
    nutrients: { db: 'TACO', id: 64 }, density: { code: '73201020', portion: '1 cup', match: 'analog' } },
  { id: 'couve-refogada', pt: 'couve refogada', en: 'sauteed collard greens', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 116 }, density: { code: '72107227', portion: '1 cup', match: 'exact' } },
  { id: 'abobrinha-refogada', pt: 'abobrinha refogada', en: 'sauteed zucchini', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 72 }, density: { code: '75233021', portion: '1 cup', match: 'exact' } },
  { id: 'espinafre-refogado', pt: 'espinafre refogado', en: 'sauteed spinach', state: 'cooked', method: 'fried',
    nutrients: { db: 'TACO', id: 120 }, density: { code: '72125217', portion: '1 cup', match: 'analog' } },

  // ---- recipes: nutrients computed from ingredient classes (assumed proportions, flagged)
  { id: 'salada-alface-tomate', pt: 'salada de alface e tomate', en: 'lettuce and tomato salad', state: 'raw', method: 'raw',
    recipe: { ingredients: [{ class: 'alface-crua', grams: 60 }, { class: 'tomate-cru', grams: 40 }],
      note: 'proportion by mass is an assumption (a typical plate side salad), not measured' },
    density: { code: '75143000', portion: '1 cup', match: 'analog' } },
  { id: 'salada-mista-crua', pt: 'salada mista crua (alface, tomate, cenoura)', en: 'mixed raw salad (lettuce, tomato, carrot)', state: 'raw', method: 'raw',
    recipe: { ingredients: [{ class: 'alface-crua', grams: 50 }, { class: 'tomate-cru', grams: 30 }, { class: 'cenoura-crua', grams: 20 }],
      note: 'proportion by mass is an assumption (a typical plate side salad), not measured' },
    density: { code: '75143000', portion: '1 cup', match: 'analog' } },

  // ---- fruit, dairy, condiment
  { id: 'banana-prata', pt: 'banana prata', en: 'banana', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 182 }, density: { code: '63107010', portion: '1 cup', match: 'exact' } },
  { id: 'maca-fuji', pt: 'maçã', en: 'apple', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 222 }, density: { code: '63101000', portion: '1 cup', match: 'exact' } },
  { id: 'laranja-pera', pt: 'laranja', en: 'orange', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 214 }, density: { code: '61119010', portion: '1 cup', match: 'exact' } },
  { id: 'abacate', pt: 'abacate', en: 'avocado', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 163 }, density: { code: '63105010', portion: '1 cup', match: 'exact' } },
  { id: 'manga', pt: 'manga', en: 'mango', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 229 }, density: { code: '63129010', portion: '1 cup', match: 'exact' } },
  { id: 'uva', pt: 'uva', en: 'grapes', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 256 }, density: { code: '63123000', portion: '1 cup', match: 'exact' } },
  { id: 'melancia', pt: 'melancia', en: 'watermelon', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 235 }, density: { code: '63149010', portion: '1 cup', match: 'exact' } },
  { id: 'mamao-formosa', pt: 'mamão', en: 'papaya', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 225 }, density: { code: '63133010', portion: '1 cup', match: 'exact' } },
  { id: 'abacaxi', pt: 'abacaxi', en: 'pineapple', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 164 }, density: { code: '63141010', portion: '1 cup', match: 'exact' } },
  { id: 'morango', pt: 'morango', en: 'strawberries', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 239 }, density: { code: '63223020', portion: '1 cup', match: 'exact' } },
  { id: 'pera', pt: 'pêra', en: 'pear', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 243 }, density: { code: '63137010', portion: '1 cup', match: 'exact' } },
  { id: 'melao', pt: 'melão', en: 'melon', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 236 }, density: { code: '63109010', portion: '1 cup', match: 'analog' } },
  { id: 'iogurte-natural', pt: 'iogurte natural', en: 'plain yogurt', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 448 }, density: { code: '11400000', portion: '1 cup', match: 'analog' } },
  { id: 'queijo-mucarela', pt: 'queijo mussarela', en: 'mozzarella cheese', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 463 }, density: { code: '14107010', portion: '1 cup, diced', match: 'exact' } },
  { id: 'maionese', pt: 'maionese', en: 'mayonnaise', state: 'raw', method: 'raw',
    nutrients: { db: 'TACO', id: 524 }, density: { code: '83107000', portion: '1 cup', match: 'exact' } },
];

// Cooking oil used for oil_g (1 g of oil = 1 g of fat = 9 kcal, Atwater). TACO row for soybean oil, the
// commonest Brazilian cooking oil; the row itself lists 100 g fat per 100 g.
export const OIL = { id: 'oleo-de-soja', pt: 'óleo de soja', en: 'soybean oil', taco_id: 272 };

// Foods a Brazilian plate often has, deliberately NOT in v0 because a real source row for one of the
// required numbers could not be found. Nothing here is estimated. Each needs a cited row before it can join.
const NO_DENSITY = 'TACO row exists, but FNDDS 2019-2020 has no volumetric (cup/tbsp) portion for this food or a close analog, so no density can be derived';
export const MISSING = [
  { id: 'farofa-de-mandioca', pt: 'farofa', taco_id: 131, reason: NO_DENSITY },
  { id: 'mandioca-frita', pt: 'mandioca frita', taco_id: 132, reason: NO_DENSITY },
  { id: 'cuscuz-de-milho', pt: 'cuscuz de milho', taco_id: 533, reason: NO_DENSITY },
  { id: 'pao-frances', pt: 'pão francês', taco_id: 53, reason: 'TACO row exists, but the only FNDDS volumetric portion for French bread is a cup of torn/cubed bread, not a density for a whole roll' },
  { id: 'pao-de-queijo', pt: 'pão de queijo', taco_id: 140, reason: NO_DENSITY },
  { id: 'feijao-tropeiro', pt: 'feijão tropeiro', taco_id: 539, reason: NO_DENSITY },
  { id: 'arroz-carreteiro', pt: 'arroz carreteiro', taco_id: 526, reason: NO_DENSITY },
  { id: 'baiao-de-dois', pt: 'baião de dois', taco_id: 527, reason: NO_DENSITY },
  { id: 'virado-a-paulista', pt: 'virado à paulista', taco_id: 555, reason: NO_DENSITY },
  { id: 'vaca-atolada', pt: 'vaca atolada', taco_id: 553, reason: NO_DENSITY },
  { id: 'salpicao-de-frango', pt: 'salpicão de frango', taco_id: 547, reason: NO_DENSITY },
  { id: 'coxinha-de-frango', pt: 'coxinha', taco_id: 386, reason: NO_DENSITY },
  { id: 'pastel-frito', pt: 'pastel de carne frito', taco_id: 56, reason: NO_DENSITY },
  { id: 'quibe-frito', pt: 'quibe frito', taco_id: 442, reason: NO_DENSITY },
  { id: 'omelete-de-queijo', pt: 'omelete de queijo', taco_id: 484, reason: NO_DENSITY },
  { id: 'queijo-minas-frescal', pt: 'queijo minas frescal', taco_id: 461, reason: NO_DENSITY },
  { id: 'tapioca-com-manteiga', pt: 'tapioca', taco_id: 551, reason: NO_DENSITY },
  { id: 'ovo-mexido', pt: 'ovo mexido', taco_id: null, reason: 'no TACO row for scrambled egg and no FNDDS scrambled-egg row with a cup portion; a recipe would need an invented oil amount' },
];

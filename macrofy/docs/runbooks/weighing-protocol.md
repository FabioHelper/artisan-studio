# Runbook: weighing and capturing benchmark meals

For the owner, alone in the kitchen. Goal: 300 meals over at least 8 weeks with weights you would
bet on. The benchmark is the only thing that measures accuracy, so a shortcut here poisons every
number later. The capture PWA (T-011, coming) will do the data entry; until then write the values
down in the format the validator expects (`bench/schema.mjs`).

## Equipment (once)

- Kitchen scale with 1 g resolution or better. If you can get a 0.1 g scale (jewellery scale), use it
  for oil, salt and sauces.
- A reference mass you trust (a sealed 500 g flour bag is fine, a coin set is better). Weigh it at the
  start of every session; if the scale is off by more than 2 g, change the battery or the scale.
- A ruler. Register each plate and bowl once: measure the inner diameter in mm (and depth for bowls)
  and give it an id. Never re-measure or guess later; the id is what meals point to.

## Per meal, in this order

1. Put the empty plate on the scale and tare it to 0 g.
2. Add ONE item at a time. Wait for the reading to settle, write its grams, tare, add the next.
   Grams are the net food weight, never including the plate. State it as raw or cooked and name the
   method (boiled, pan-fried, grilled, raw).
3. Oil: weigh the oil bottle or a spoon before and after pouring into the pan (0.1 g scale if you
   have it). Split that oil across the items cooked in the pan in proportion to how much each
   absorbed, and record it as oil_g on those items.
4. Photograph before eating (see below).
5. Eat. If food is left, weigh what remains on the plate and record it as leftovers_g. Never guess it.

## Photos (per meal, at least three)

- Overhead, about 90 degrees, plate centred, whole rim in frame.
- Diagonal, about 45 degrees.
- One natural handheld shot, the way you would really use the app.
- Distance 25 to 50 cm. Keep the plate fully visible in every shot. Do not use zoom.
- Take them after weighing, before eating. Do not retake to pick the "best" one: all shots stay.

## Variety (the benchmark must look like real life)

Across the 8+ weeks deliberately vary: lighting (daylight, warm bulb, dim evening, flash), plates
and bowls (at least three different ones), table surfaces, angles and distances, and dishes
(rice and beans, pasta, meat, salad, mixed plates, soups). Two meals a day is plenty; do not batch
weigh a week in one afternoon.

## Splits and honesty rules

- The split is by capture date: pick a day's split before eating (a coin flip works) and put every
  meal of that day in it. A date never appears in both. Aim for 150 calibration and 150 test.
- Never move a meal between splits, never delete an awkward meal from the test split, and do not
  look at model output for test meals while collecting.
- When the last test meal is in, freeze it with `node bench/lock.mjs`. After that, test meals must
  not change. A real correction needs `--relock --reason "..."` and a matching `mc note`.
- Photos stay on your phone or disk, never in git. The manifest only holds each photo's sha256 and
  perceptual hash.

## Check your work

`node bench/validate.mjs` checks the manifest (weights, ids, leakage, lock). The full target is
`node bench/validate.mjs --require-meals 300 --min-weeks 8`. Every problem it prints has a fix hint.

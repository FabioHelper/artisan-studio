# Runbook: weighing and capturing benchmark meals

For the owner, alone in the kitchen. Goal: 300 meals over at least 8 weeks with weights you would
bet on. The benchmark is the only thing that measures accuracy, so a shortcut here poisons every
number later. The capture app does the data entry and writes the manifest for you (see "Using the capture app"
below); the format it emits is defined in `bench/schema.mjs`.

## Equipment (once)

- Kitchen scale with 1 g resolution or better. If you can get a 0.1 g scale (jewellery scale), use it
  for oil, salt and sauces.
- A reference mass you trust (a sealed 500 g flour bag is fine, a coin set is better). Weigh it at the
  start of every session; if the scale is off by more than 2 g, change the battery or the scale.
- A ruler. Register each plate and bowl once: measure the outer diameter of the rim in mm (edge to
  edge across the centre, ruler resting on top of the rim) and, for bowls, the depth. Never
  re-measure or guess later; the registered plate is what meals point to.

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

- The split is by capture date and the app assigns it: odd ISO week number is calibration, even is
  test, so a date never appears in both and you cannot choose or change it. Expect roughly 150 of
  each over 8+ weeks.
- Never move a meal between splits, never delete an awkward meal from the test split, and do not
  look at model output for test meals while collecting.
- When the last test meal is in, freeze it with `node bench/lock.mjs`. After that, test meals and the plates
  they use must not change; a complete benchmark cannot pass without the lock. A real correction needs `--relock --reason "..."` and a matching `mc note`.
- Photos stay on your phone or disk, never in git. The manifest only holds each photo's sha256 and
  perceptual hash.

## Using the capture app

Open https://fabiohelper.github.io/artisan-studio/app/ in Safari on the iPhone (the address is the
same for the whole 8+ weeks).

1. **Install it first.** Tap Share, then "Adicionar à Tela de Início", and open Macrofy from the new
   icon. Safari may erase the data of sites that are not installed, so do not skip this.
2. **Once:** "Pratos e balança": enter the scale model and resolution, then add each plate and bowl
   with its rim outer diameter (the screen shows how to measure).
3. **Each meal:** "Pesar refeição". Pick the plate, take the photos (angle: Topo, 45° or Natural;
   lighting), search and add each item with its grams (whole grams, net food), optional oil_g,
   leftovers and notes, then "Salvar refeição". A half-entered meal is kept as a draft if the app
   closes. The date, time and split shown at the top are automatic.
4. **Export often** (at least weekly): "Exportar manifesto". The app checks the same rules as
   `node bench/validate.mjs` and lists problems in Portuguese; fix them before it lets you export.
   Photos never leave the phone: the file holds only each photo's sha256 and perceptual hash.
5. **Hand it to us**, either way:
   - GitHub web UI: open the artisan-studio repository, go to the `macrofy/bench` folder, "Add
     file" then "Upload files" (or edit `manifest.json` if it exists) and commit the exported file
     under the name `manifest.json`; or
   - paste the text into the Claude chat: in the export screen tap "Copiar texto para colar no chat".

Each export contains everything saved so far, so the newest file replaces the previous one. A saved
meal cannot be edited: to fix a typo delete it and enter it again (never delete a test meal only
because it turned out badly).

## Check your work

`node bench/validate.mjs` checks the manifest (weights, ids, leakage, lock). The full target is
`node bench/validate.mjs --require-meals 300 --min-weeks 8`. Every problem it prints has a fix hint.

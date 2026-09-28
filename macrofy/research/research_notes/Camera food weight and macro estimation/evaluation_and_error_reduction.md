# Evaluation and error-reduction methodology for a photo-based food weight and macro estimator (Macrofy), as of late 2026

Research note. Tooling caveat: in this session the egress proxy blocked full-text fetches from arxiv.org, openreview.net, thecvf.com, PubMed/PMC and most publisher sites. Only github.com could be fetched in full. Most findings below therefore come from search-engine snippets of the primary sources (URLs given), not from full-text reads. Numbers that could only be seen in secondary or aggregator snippets are flagged. Anything marked "Inference" is my reasoning or arithmetic, not a sourced fact.

## 1. Ground-truth protocols: weighed records, Nutrition5k and MetaFood3D capture, scale precision, capture variation, sample size, leakage

### Takeaway
The accepted reference is the weighed food record: weigh each item, ideally one ingredient at a time. Nutrition5k did this in cafeterias with an incremental add-weigh-scan procedure and multi-angle plus overhead RGB-D capture. MetaFood3D weighed single items and linked each to FNDDS food codes. For evaluation, the rule that matters most is to keep every capture of one plate (and ideally one user) inside a single split.

### Cited Findings
- Nutrition5k has 5,006 plates of food and totals 181.4 GB. It was captured with four Raspberry Pi cameras placed 90° apart, recording side-angle videos at alternating 30° and 60° viewing angles, plus an overhead RGB-D image from an Intel RealSense (depth units: 1 m = 10,000 units; maximum depth 0.4 m) — [Nutrition5k GitHub](https://github.com/google-research-datasets/Nutrition5k)
- Nutrition5k used an "incremental scanning procedure". Items from buffet-style cafeterias were added to a plate or bowl one at a time, with a scan after each addition, and the incremental weights produced per-ingredient ground truth. Professional instruments were used to weigh, scan and record each dish — [Nutrition5k paper (arXiv 2103.03375)](https://arxiv.org/pdf/2103.03375); [ResearchGate copy](https://www.researchgate.net/publication/349880533_Nutrition5k_Towards_Automatic_Nutritional_Understanding_of_Generic_Food)
- Leakage control in Nutrition5k: "all incremental scans that compose a unique plate are held within the same split, to avoid overlap between the train and test splits". Official split IDs ship in `dish_ids/splits/` — [Nutrition5k GitHub](https://github.com/google-research-datasets/Nutrition5k)
- Nutrition5k license is Creative Commons 4.0 (CC BY 4.0), which allows sharing and adaptation for any purpose, including commercial use — [Nutrition5k GitHub](https://github.com/google-research-datasets/Nutrition5k)
- MetaFood3D has 743 scanned and labeled 3D food objects in 131 categories, each annotated with weight, energy, protein, carbohydrate and fat, plus food codes linked to a nutrition database — [MetaFood3D arXiv 2409.01966](https://arxiv.org/abs/2409.01966); [project page](https://lorenz.ecn.purdue.edu/~food3d/)
- MetaFood3D recorded weight and nutrition at collection time and linked each item to FNDDS (USDA Food and Nutrient Database for Dietary Studies) to get nutrient densities. Meshes came from a Revopoint POP 2 3D scanner on a turntable. RGB-D video covered 720° (object rotated twice in a spiral) and ended with an overhead shot. Modalities include textured meshes, RGB-D video and segmentation masks — [MetaFood3D arXiv HTML v2](https://arxiv.org/html/2409.01966v2); [Moonlight review](https://www.themoonlight.io/en/review/metafood3d-3d-food-dataset-with-nutrition-values) (secondary summary)
- The MetaFood CVPR 2024 challenge used a visible checkerboard and a pattern mat as scale references. It had 20 food items at three difficulty tiers: easy (200 images), medium (30 images) and hard (1 image). Volume MAPE against scanned-mesh ground truth was the portion metric, and 16 teams submitted to the final phase — [MetaFood CVPR 2024 challenge report (arXiv 2407.09285)](https://arxiv.org/html/2407.09285v1); [challenge site](https://sites.google.com/view/cvpr-metafood-2024/challenge)
- The Nutrition5k authors argue that human-rater portion annotation is not a viable way to collect ground truth: professional nutritionists had about 41% average error in visual portion estimation and non-nutritionists about 53% — [Nutrition5k paper via search snippet](https://arxiv.org/pdf/2103.03375)
- Weighed dietary records are the usual reference in app validation studies. Example: FoodLog Athl vs. weighed records, with 36 university students recording both ways at the same time for 10 consecutive days — [PubMed 41901155](https://pubmed.ncbi.nlm.nih.gov/41901155/)
- Bland–Altman sample size: Lu et al. (2016) give a sample-size method based on the distribution of differences and predefined clinical agreement limits, with explicit Type II error control. Older practice sized studies only by the expected width of the limit-of-agreement confidence interval — [Lu et al., Int J Biostatistics](https://www.degruyterbrill.com/document/doi/10.1515/ijb-2015-0039/html)
- The approximate Bland–Altman confidence intervals for limits of agreement do not keep equal-tailed error rates at small n, so the exact interval procedure is recommended — [PMC5964973](https://pmc.ncbi.nlm.nih.gov/articles/PMC5964973/); [Computers in Biology & Medicine](https://www.sciencedirect.com/science/article/abs/pii/S0010482518301677)

### Inferences
- Proposed Macrofy ground-truth protocol, modeled on Nutrition5k:
  1. Tare the plate.
  2. Add one food item at a time and record its grams.
  3. Photograph after each addition (this yields both per-item and per-meal labels).
  4. After eating, weigh the leftovers so you can evaluate consumed as well as served amounts.
  5. For mixed dishes (feijoada, strogonoff, farofa mixed into rice), weigh the raw ingredients of the recipe and the cooked yield, and compute nutrient density per 100 g of the cooked dish.
- Nutrition values should come from one pinned database version so benchmark results stay comparable. For Brazil that would be TACO/TBCA; for US foods, FNDDS as MetaFood3D used. This is my recommendation; the Brazilian databases were not researched in this note.
- Scale precision: I found no source that gives a required resolution. My inference is that a 1 g-resolution kitchen scale with at least 5 kg capacity is enough for plates. Items under about 20 g, such as oils, sauces and butter, need 0.1 g resolution, because 1 g on a 10 g oil portion is already 10%, or about 9 kcal. The scale should be checked each session against a reference weight, for example a 500 g calibration mass or a sealed 1 L water bottle. See Gaps.
- Capture conditions to vary on purpose, as a stratified factorial rather than random:
  - camera angle: roughly 90° overhead, about 45–60° oblique, and about 30° low (Nutrition5k used 30° and 60° side angles plus overhead)
  - distance, e.g. 25–50 cm
  - lighting: daylight, warm indoor, dim restaurant, flash
  - plate: white, patterned, dark, bowls, marmitex/aluminium takeout trays
  - background clutter
  - occlusion/stacking, e.g. feijão poured over arroz
  - device: at least 2–3 phone models, with and without LiDAR/ToF
- Record each factor as metadata so the acceptance checks can report error per stratum.
- Leakage rules for Macrofy, generalizing Nutrition5k's plate-level grouping:
  - Split by meal (all photos and incremental states of one plate together).
  - Also split by user/household and by capture session, so near-identical plates on the same table do not straddle splits.
  - Keep a held-out-user test set for personalization claims.
  - Deduplicate near-duplicate images by perceptual hash.
  - Never tune thresholds or conformal calibration on the test set; use a separate calibration split.
- Sample size needed for a MAPE confidence interval (my arithmetic, not a sourced figure). The 95% CI half-width of a mean absolute percentage error is about 1.96 × SD(APE) / √n.
  - Meal-level kcal APE in the literature is around 15–40%, and APE distributions are right-skewed. A per-meal SD(APE) of about 20–30 percentage points is a plausible working assumption.
  - With SD = 25 pp: n = 100 meals gives about ±4.9 pp; n = 200 gives about ±3.5 pp; n = 300 gives about ±2.8 pp.
  - Per-item metrics have many more units (items), but they are clustered within meals and users. Use a cluster (meal- or user-level) bootstrap for CIs instead of treating items as independent.
  - Bland–Altman limits of agreement: the standard approximation (Bland & Altman 1986; not re-fetched here) gives SE(LoA) ≈ √(3/n) × SD(diff). At n = 100 the 95% CI of each limit is about ±0.34 SD. Use the exact procedure the sources above recommend.

### Gaps
- I could not open the Nutrition5k and MetaFood3D full texts (egress blocked), so I could not confirm the scale make/model or resolution either dataset used. The GitHub README only says "incremental scanning" and does not name the scale.
- MetaFood3D's dataset license was not confirmed. Check the [project page](https://lorenz.ecn.purdue.edu/~food3d/) before any commercial use.
- No source found that states a minimum dataset size specifically for MAPE CIs in food-image estimation. The numbers above are standard statistics under an assumed SD.
- A 2025 PMC paper, "[2D Prediction of the Nutritional Composition of Dishes … Data Curation Beyond the Nutrition5k Project](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12252204/)", suggests Nutrition5k labels needed curation. I could not read what label problems it found.

## 2. Metrics accepted by validation studies and dietitians

### Takeaway
Computer-vision papers report MAE and MAPE (per-meal kcal, mass, and each macro in grams). Nutrition validation studies add mean bias with Bland–Altman limits of agreement, correlation (Pearson/Spearman), and the share of estimates within ±10% of truth. A credible Macrofy benchmark should report all three families, plus interval coverage.

### Cited Findings
- Nutrition5k reports MAE both in absolute units and as a percentage of the mean for calories, mass, fat, carbs and protein. Direct RGB prediction: calorie MAE 26.1%, aggregate macronutrient MAE 31.9% — [Nutrition5k paper](https://arxiv.org/pdf/2103.03375) (via search snippet)
- MetaFood CVPR 2024 used volume MAPE as the portion-size metric plus 3D shape metrics — [arXiv 2407.09285](https://arxiv.org/html/2407.09285v1)
- Validation studies use Bland–Altman plots. In the Keenoa app study, most nutrients fell within an acceptable range of agreement, but energy, protein, carbohydrates, fat (%), saturated fat, iron, potassium and sodium did not — [JMIR mHealth 2020](https://mhealth.jmir.org/2020/9/e16953)
- DietBytes (pregnant women) reported correlations of r = 0.58–0.84 for energy, macronutrients and fiber, and Bland–Altman plots with acceptable agreement and no systematic bias — [PMC5295117](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5295117/)
- An AI-assisted dietary app used in anorexia nervosa had moderate-to-high correlation for total energy (ρ = 0.62) with no systematic bias on Bland–Altman, though the app tended to overestimate — [PubMed 41754225](https://pubmed.ncbi.nlm.nih.gov/41754225/)
- FoodLog Athl vs. weighed records showed significant positive correlations for energy and most nutrients (not iron, vitamin B1 or salt) but systematic overestimation of energy and major macronutrients. This shows correlation can look fine while bias is present — [PubMed 41901155](https://pubmed.ncbi.nlm.nih.gov/41901155/)
- The "percentage of portion estimates within ±10% of actual weight" is used as the accuracy standard in dietetic image-based portion studies — [Nutrients 2018, PMC6115988](https://pmc.ncbi.nlm.nih.gov/articles/PMC6115988/)
- Openfit's pilot validation also reported food-identification metrics: exact match, far match and intrusion (a food logged that was not present) rates — [Current Developments in Nutrition 2023](https://cdn.nutrition.org/article/S2475-2991(23)26593-2/fulltext)

### Inferences
Proposed metric suite for automated acceptance checks:

- **Recognition**
  - Item precision/recall with "exact / far / intrusion / omission" categories (the Openfit taxonomy).
  - Omission rate matters most for the hidden high-kcal items (oil, sauces, cheese).
- **Per-item mass**
  - MAE (g), MAPE (%), median APE, and the share within ±10%, ±20% and ±30%.
  - Report per food class and per stratum (angle, lighting, plate).
  - Exclude items under 10 g from MAPE and use absolute-gram error for them, because MAPE blows up for tiny items.
- **Per-meal**
  - kcal MAE (kcal), MAPE, and signed mean bias (%). Systematic underestimation is the documented failure mode.
  - Protein, carbs and fat MAE in grams.
  - Share of meals within ±10%, ±20%, ±25%.
- **Agreement**
  - Bland–Altman mean difference and 95% LoA for kcal and each macro, with exact CIs.
  - Check proportional bias with a regression of difference on mean.
  - Consider a log-ratio Bland–Altman if error grows with portion size.
- **Daily-level aggregation**
  - Simulate days by summing 3–5 meals per user. Random per-meal errors partly cancel, systematic bias does not. Report day-level kcal APE as the user-facing number.
- **Uncertainty**
  - Empirical coverage of the 80% and 90% intervals, overall and per stratum, plus mean interval width in grams and kcal. See section 4.
- **Error decomposition, following Nutrition5k's portion-independent experiment**
  1. Evaluate with ground-truth labels and predicted mass.
  2. Evaluate with predicted labels and ground-truth mass.
  3. Evaluate end-to-end.
  - This shows whether recognition, portion or nutrient-database error dominates.

### Gaps
- I found no professional-body guideline (e.g., Academy of Nutrition and Dietetics, ASBRAN) that sets a single mandatory metric or pass threshold for app validation. Practice varies by study.

## 3. Error-reduction techniques and evidence on their size

### Takeaway
User confirmation or correction of recognized items has the strongest direct evidence (Openfit: exact food matches rose from 46% to 87%, intrusions fell from 13% to 0%). Portion error, not recognition, is the dominant error source. Multi-view capture with a known-size reference reaches under 10% volume error in lab settings. Follow-up questions about hidden ingredients (oil, sauces) target the main documented failure mode. I found no quantified evidence for per-user scale calibration or ensembling in food-portion apps.

### Cited Findings
- Openfit (video capture, no physical reference marker, n = 24 adults):
  - Automated food identification: 46% exact matches, 41% far matches, 13% intrusions.
  - Semi-automated (user can search the correct food and set the portion): 87% exact, 23% far, 0% intrusions.
  - Energy error, automated vs. semi-automated: 43% and 33% with beverages; 16% and 42% without beverages.
  - Meal-level energy error ranged from 31% (salad) to 82% (chicken meal).
  - [Current Developments in Nutrition 2023](https://cdn.nutrition.org/article/S2475-2991(23)26593-2/fulltext); [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2475299123265932)
  - Note: user correction improved energy error with beverages but made it worse without beverages (16% → 42%). Unguided manual portion entry can add error.
- Another summary of the same study reports semi-automated exact matches of 81% (salad meal) to 98% (hamburger meal) with no intrusions, and stresses letting users change AI-assigned food labels — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2475299123265932) (via search snippet)
- Portion estimation dominates error. In Nutrition5k, direct calorie prediction had about 3× the MAE of portion-independent (per-gram) prediction: 26.1% vs 9.5% — [Nutrition5k paper](https://arxiv.org/pdf/2103.03375) (via search snippet)
- Depth helps. A Nutrition5k-derived summary says models using the depth sensor reached about 16.5% calorie MAE, compared with 26.1% for RGB-only direct prediction — [search snippet summarizing Nutrition5k](https://arxiv.org/pdf/2103.03375). I could not verify the 16.5% figure against the paper's table.
- A two-view 3D reconstruction using a credit-card-sized reference card, tested on real dishes of known volume, reached average volume error under 10% at 5.5 s per dish — [Human-Mimetic Estimation of Food Volume, PMC8455030](https://pmc.ncbi.nlm.nih.gov/articles/PMC8455030/) (related-work statement in that paper)
- Fiducial markers such as checkerboards or credit-card-like cards must be carried and placed by the user before eating, which is burdensome and hard to implement. This motivated marker-free smartphone methods — [Public Health Nutrition 2018, "without a fiducial marker"](https://www.cambridge.org/core/journals/public-health-nutrition/article/imagebased-food-portion-size-estimation-using-a-smartphone-without-a-fiducial-marker/47ED461DDE607FE0C7E6D70168E80BFA); [PMC8455030](https://pmc.ncbi.nlm.nih.gov/articles/PMC8455030/)
- In MetaFood 2024, the number of views defined difficulty: 200 images (easy), 30 (medium), 1 (hard) — [arXiv 2407.09285](https://arxiv.org/html/2407.09285v1)
- Hidden fat is the main failure. An NIH/NIDDK abstract presented at NUTRITION 2026 (American Society for Nutrition, 25 July 2026; not yet peer-reviewed) tested MyFitnessPal, Lose It!, Cal AI and Appediet on standardized photos of 102 controlled-diet meals:
  - The apps underestimated calories by about one third (about 250–345 kcal per meal) and fat by about 30 g per meal.
  - Some also underestimated carbohydrates.
  - They did worst on high-fat and ketogenic meals.
  - [ScienceDaily](https://www.sciencedaily.com/releases/2026/07/260726015237.htm); [EurekAlert](https://www.eurekalert.org/news-releases/1136415); [Medscape](https://www.medscape.com/viewarticle/photo-based-meal-apps-underestimate-calories-and-fat-2026a1000qo9)
- For ChatGPT-style models, food identification is strong (about 93% precision) but energy MAPE is about 26–36%. Portion weight was under-predicted in about 76% of medium and large meals — [kcalm.app review of 2025 studies](https://kcalm.app/blog/chatgpt-calorie-counting-accuracy/) (aggregator; the primary source it relies on includes [PMC11858203](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11858203/), which I could not open)
- Follow-up questions:
  - SnappyMeal (University of Washington, arXiv Nov 2025) asks goal-dependent follow-up questions to fill in missing context and pulls from grocery receipts and nutrition databases to improve accuracy.
  - A 3-week, multi-user, in-the-wild deployment logged more than 500 food instances. Users reported strong perceived accuracy and preferred mixing modalities (images for meals, text for snacks).
  - [arXiv 2511.03907](https://arxiv.org/abs/2511.03907)
- Training human estimators on image-based portion assessment helps:
  - Dietetics students' share within ±10% rose from 23% to 32%.
  - Their mean absolute error fell from 27% to 16%.
  - [PMC7827495](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7827495/)
- The 2026 survey "Food Portion Estimation: From Pixels to Calories" (Vinod & Zhu) groups mitigation strategies into auxiliary depth maps, multi-view input, model-based and template-matching methods, and monocular deep learning — [arXiv 2602.05078](https://arxiv.org/abs/2602.05078)

### Inferences
Techniques ranked by likely value for Macrofy, based on the evidence above:

1. **Confirm labels.** Show recognized items as editable chips before computing macros, and track the correction rate as a product metric. Directly supported by Openfit.
2. **Ask about hidden fats.** Use one-tap prompts ("cooked with oil? how much: none / a little / a lot", "sauce or dressing?", "cheese/butter?"). This targets the documented about 30 g fat underestimation. Use fixed-choice prompts, not free-text grams, because Openfit shows unguided manual portion entry can make error worse.
3. **Guide the portion slider.** Anchor the slider on the model estimate and show visual references (half/one/two serving-spoon images, which are common in Brazilian household-measure tables) rather than a blank gram field.
4. **Use depth and a second view.** Use LiDAR/ToF depth where the phone has it. Otherwise prompt for a second oblique photo (about 45°) in addition to the overhead one. Evidence: depth improved Nutrition5k calorie MAE; multi-view with a reference reached under 10% volume error.
5. **Use the plate or cutlery as the scale reference.** Let users register their usual plate diameter once, rather than carrying a card. The literature calls card markers burdensome. This is my inference, not tested evidence.
6. **Confidence gate.** When the predicted interval is too wide (e.g., the 80% interval spans more than ±35% of the point estimate) or recognition confidence is low, ask the user one question instead of silently logging.
7. **Per-user calibration.** Occasionally ask users to weigh one meal. Fit a per-user, per-food-class multiplicative bias correction (shrunk toward 1 via a hierarchical prior), and evaluate it on held-out weighings of the same users. Effect size is unproven; see Gaps.
8. **Ensembles and test-time augmentation.** Average predictions across several views or models. They are also a cheap source of uncertainty (see section 4).

Every technique should ship with an A/B-style offline test: the same benchmark meals, with and without the technique, reporting the change in kcal MAPE with a paired bootstrap CI.

### Gaps
- I found no published effect size for per-user calibration from occasional scale weighings, for active learning, or for ensembling, specifically in food-portion apps.
- No controlled study was found that isolates "2–3 photos vs. 1 photo" on a phone in free-living use. Multi-view evidence comes from lab or challenge settings (MetaFood, the two-view reference-card work).
- The 16.5% depth figure is from a secondary snippet and was not verified against Nutrition5k's table.

## 4. Uncertainty: producing a weight/kcal range and presenting it honestly

### Takeaway
Split conformal prediction, in particular conformalized quantile regression (CQR), gives distribution-free, finite-sample coverage guarantees and per-meal adaptive interval widths. It needs only a held-out calibration set of weighed meals, so it fits a 100–300-meal in-house benchmark. I found no published food-portion paper that applies conformal prediction, so Macrofy would be ahead of the published literature here.

### Cited Findings
- Conformal prediction builds prediction sets or intervals that contain the true value with a user-specified probability (e.g., 90%). It is distribution-free and uses the errors on a held-out calibration set to set interval width. Intervals widen for inputs that differ from the training data — [Angelopoulos & Bates, "A Gentle Introduction to Conformal Prediction"](https://arxiv.org/pdf/2107.07511); [BBVA AI Factory explainer](https://www.bbvaaifactory.com/conformal-prediction-an-introduction-to-measuring-uncertainty/)
- Split conformal prediction divides data into training, calibration and test sets. Only conformal methods guarantee nominal coverage in finite samples — [Conformal Prediction: A Data Perspective (arXiv 2410.06494)](https://arxiv.org/pdf/2410.06494)
- Conformalized Quantile Regression (Romano et al., 2019) combines quantile regression with conformal calibration and is a leading method for adaptive-width intervals. It is also described in Angelopoulos & Bates — [CQR (ResearchGate)](https://www.researchgate.net/publication/332960825_Conformalized_Quantile_Regression); [arXiv 2502.16336](https://arxiv.org/pdf/2502.16336)
- Mondrian (group-conditional) conformal prediction, which calibrates separately per category, has been applied in food-safety risk assessment. That is the closest food-domain use I found — [Frontiers in Food Science & Technology 2026](https://www.frontiersin.org/journals/food-science-and-technology/articles/10.3389/frfst.2026.1890831/full)
- A search for conformal prediction applied to food portion or calorie estimation found no specific published work — [search result summary; no primary source found]

### Inferences
- Recommended approach:
  1. Train a mass (or log-mass) regressor with quantile heads (e.g., 10th/50th/90th percentiles) per item.
  2. Conformalize on a calibration split of weighed items. Use log or ratio nonconformity scores so the interval scales with portion size.
  3. Use Mondrian calibration per food group (grains, beans, meats, leafy veg, fried items, sauces/oils) and per capture mode (depth vs. no depth), so coverage holds per group and not only on average.
  4. Carry item intervals through to meal kcal. Either do Monte Carlo sampling from item quantiles, or calibrate a second conformal layer directly on meal-level kcal residuals. The second option is simpler and keeps the guarantee at the level the user sees.
- Cheap uncertainty signals to feed CQR or a confidence gate, all without paid APIs:
  - Disagreement across a deep ensemble or across test-time augmentations/views.
  - MC dropout variance.
  - Depth-map noise or missing-pixel fraction, propagated to volume.
  - Segmentation-mask confidence.
  - These are heuristic until conformalized. Conformal calibration converts any such score into a guaranteed-coverage interval.
- Calibration set size: split-conformal coverage is exact in expectation for any n. With n ≈ 100–200 calibration meals, the realized coverage of a 90% interval will fluctuate by a few percentage points. Reserve at least 100 weighed meals for calibration, separate from the test set. This is inference from standard conformal theory, not a sourced number.
- Acceptance check: on the test split, empirical coverage of the nominal 80% (and 90%) interval must be within [nominal − 5 pp, nominal + 5 pp] overall and for each major food group with at least 30 items. Track mean relative interval width as the efficiency metric.
- Honest UI:
  - Show the point estimate prominently, with a range beneath it ("≈ 520 kcal · likely 430–640").
  - State the coverage in plain language in an info tooltip ("8 in 10 meals like this fall in this range").
  - Show wider ranges without apology, and offer the quickest way to narrow them ("Add a side photo" / "Confirm oil").
  - Avoid false precision: round kcal to 10 and grams to 5.
  - Aggregate daily totals with their own (narrower, relatively speaking) interval.
  - These are design inferences. I found no HCI study that tested range displays in food apps.

### Gaps
- No peer-reviewed study found on conformal prediction, MC dropout or depth-uncertainty propagation for food portion estimation specifically.
- No HCI study found on how users interpret or trust calorie ranges vs. point estimates.

## 5. Realistic targets: what validated systems achieve and what professionals accept

### Takeaway
Fully automated photo estimation typically lands at about 15–40% per-meal energy error, with systematic underestimation of fat-rich meals. Professional nutritionists estimating from images do no better: about 41% error untrained, about 16% absolute error after dedicated training, and under one third of their estimates within ±10%. The ±10% threshold is the "accurate" standard in dietetic portion research, but few systems meet it per meal.

### Cited Findings
- Nutrition5k: calorie MAE 26.1% (RGB direct), aggregate macro MAE 31.9%, and 9.5% when portion is given. Professional nutritionists had about 41% error and laypeople about 53% — [Nutrition5k paper](https://arxiv.org/pdf/2103.03375) (via search snippets)
- Nutrition professionals from images: fewer than one third estimated portion within ±10% of actual weight (23.7% for one image set, 32.3% for another), although food identification was good — [Nutrients 2018, PMC6115988](https://pmc.ncbi.nlm.nih.gov/articles/PMC6115988/)
- Dietetics students with repeated image-based training: within ±10% rose from 23% to 32%, and absolute error fell from 27% to 16% — [PMC7827495](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7827495/)
- Openfit automated energy error was 16% without beverages and 43% with beverages. Meal-level error ranged from 31% to 82% — [Current Developments in Nutrition 2023](https://cdn.nutrition.org/article/S2475-2991(23)26593-2/fulltext)
- Commercial photo apps (MyFitnessPal, Lose It!, Cal AI, Appediet) underestimated about one third of calories: about 250–345 kcal per meal and about 30 g fat per meal. Preliminary, not peer-reviewed — [ScienceDaily July 2026](https://www.sciencedaily.com/releases/2026/07/260726015237.htm); [Medical Daily](https://www.medicaldaily.com/ai-calorie-tracking-apps-underestimate-calories-fat-nih-study-2026-476487)
- General-purpose multimodal LLMs (ChatGPT/Claude): energy MAPE of about 26–36% (about 35.8% in one 2025 study) — [kcalm.app aggregator](https://kcalm.app/blog/chatgpt-calorie-counting-accuracy/); primary study: [PMC11858203](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11858203/) (not opened)
- Treat with caution: a "Dietary Assessment Initiative" web page claims a 180-meal weighed-reference study with calorie MAPE of 1.1% for PlateLens photo mode, 4.8% MacroFactor, 5.1% Foodvisor, 6.8% Cronometer, 9.4% Lose It! and 11.2% MyFitnessPal — [dietaryassessmentinitiative.org](https://dietaryassessmentinitiative.org/publications/six-app-validation-study-2026/). Reasons for doubt:
  - I could not open it or verify authors, funding or peer review.
  - Its numbers conflict sharply with the NIH/ASN 2026 findings and all other literature above (about one-third underestimation for Lose It! and MyFitnessPal).
  - PlateLens marketing pages appear alongside it in search results.
  - Report it as unverified and possibly promotional. Do not use it as a benchmark target.
- Mixed validation outcomes: Keenoa showed no Bland–Altman agreement for energy or macros — [JMIR mHealth 2020](https://mhealth.jmir.org/2020/9/e16953). DietBytes showed acceptable agreement with no bias — [PMC5295117](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5295117/). FoodLog Athl systematically overestimated — [PubMed 41901155](https://pubmed.ncbi.nlm.nih.gov/41901155/)

### Inferences
Proposed tiered acceptance targets for Macrofy's in-house benchmark:

| Tier | Per-meal kcal MAPE | Per-item mass MAPE | Signed bias |
|---|---|---|---|
| MVP (fully automated, single photo) | ≤ 30% | ≤ 35% | kcal \|bias\| ≤ 10% |
| Standard (with label confirmation and hidden-fat prompts) | ≤ 20% | — | fat bias within ±15%; ≥ 40% of meals within ±10% kcal; ≥ 70% within ±25% |
| Stretch (depth or two-view plus per-user calibration) | ≤ 15% | ≤ 20% | — |

- MVP rationale: this beats the documented one-third underestimation of commercial apps and matches or beats human nutritionists (about 41%). MVP also requires 80% interval coverage of 75–85%.
- Standard rationale: at this level Macrofy is comparable to trained dietitians (about 16% absolute error).
- Stretch: approaching the ±10% "accurate" standard on average, meal by meal.
- Always report daily-total error too. Random per-meal errors partly cancel over a day, so daily kcal MAPE should come out below per-meal MAPE. If it does not, systematic bias dominates.
- Acceptance checks should gate on the upper bound of the 95% CI of MAPE, not the point estimate, and on signed bias. Bias is the documented clinical failure mode (underestimating fat and kcal).

### Gaps
- I found no formal consensus statement from dietetic associations defining "acceptable" error for consumer apps. ±10% (portion) is the commonly used research standard, and ±20% appears informally.
- Per-item macro-gram error targets (protein, carbs, fat in g) from validated apps were not found in the sources I could access.

## 6. Building a cheap in-house benchmark (100–300 weighed meals, Brazilian focus) and bootstrapping from open data

### Takeaway
Nutrition5k (CC BY 4.0, commercial use allowed) is the best open bootstrap set with per-ingredient weights and depth. MetaFood3D adds per-item weights and meshes, but its license is unconfirmed. For Brazil, the MyFood dataset (Zenodo) covers segmentation and classification of commonly eaten Brazilian foods but, as far as I found, has no weights. So the Brazilian weighed benchmark has to be collected in-house.

### Cited Findings
- Nutrition5k: 5,006 plates, per-ingredient masses in metadata CSVs, overhead RGB-D plus side videos, official leakage-safe splits, CC BY 4.0 allowing commercial use — [GitHub](https://github.com/google-research-datasets/Nutrition5k)
- MetaFood3D: 743 objects / 131 categories with weight, FNDDS codes and macros, meshes, RGB-D video and masks — [arXiv 2409.01966](https://arxiv.org/abs/2409.01966); [project page](https://lorenz.ecn.purdue.edu/~food3d/)
- MetaFood CVPR 2024 challenge data: 20 items with a checkerboard reference, 1 to 200 views, volume ground truth — [arXiv 2407.09285](https://arxiv.org/html/2407.09285v1); [Kaggle rules](https://www.kaggle.com/competitions/cvpr-metafood-3d-food-reconstruction-challenge/rules); winning pipeline code: [VolETA-MetaFood GitHub](https://github.com/GCVCG/VolETA-MetaFood)
- MyFood (Brazil):
  - Foods were chosen from a Vigilantes do Peso (Weight Watchers Brazil) survey of the most consumed foods in Brazil, filtered to the most common daily foods.
  - Images were resized to 512×512.
  - Available on Zenodo (doi:10.5281/zenodo.4041488).
  - Mask R-CNN reached mAP 0.87 for segmentation and classification.
  - [MyFood arXiv 2012.03087](https://arxiv.org/pdf/2012.03087)
- Nutrition5k-trained models generalize to new data only with caveats. A 2025 paper studies algorithm selection and "data curation beyond the Nutrition5k project" — [PMC12252204](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12252204/)
- Human visual annotation of portion size is too inaccurate (about 41–53% error) to serve as ground truth. Weigh, do not eyeball — [Nutrition5k](https://arxiv.org/pdf/2103.03375)

### Inferences
**Collection plan (cheap).** 150 meals for calibration and development plus 150 for a locked test set. Use about 10–20 volunteer households or users, split by user.

- **Menu coverage.** Stratify toward the target diet:
  - Staples: arroz, feijão (carioca/preto), farofa, bife/frango grelhado, ovo frito, salada, macarrão, batata frita, mandioca.
  - Dishes: feijoada, strogonoff, PF/prato feito, marmita, pão francês, tapioca, pão de queijo, açaí bowls, cuscuz.
  - Include restaurant "comida por quilo" plates. They come with a printed weight on the receipt, a free (if coarse) mass label; verify with your own scale.
- **Equipment, about US$30–60 per kit.**
  - 1 g / 5 kg digital kitchen scale, plus a 0.1 g / 500 g pocket scale for oils and sauces.
  - A known-diameter plate.
  - A phone tripod or stand for the standardized overhead shot.
  - Handheld free-form shots on top of that, to reflect real use.
- **Protocol per meal (Nutrition5k-style incremental).**
  - Tare the plate, add each item, and after each addition record grams and take photos: overhead, 45°, and the user's natural handheld shot.
  - Log metadata: device, lighting, plate type, cooking fat added (weigh the oil used in the pan and apportion it).
  - Weigh leftovers after the meal.
- **Nutrient mapping.** Map each item to a pinned version of the national composition table (TBCA/TACO) by code. Record the recipe and cooked yield for mixed dishes.
- **Annotation tooling (open-source, no paid APIs).**
  - CVAT or Label Studio for masks and bounding boxes, pre-filled by a segmentation model (SAM-family) and corrected by a human.
  - A simple form or spreadsheet for the weights keyed by meal_id/item_id.
  - Store everything as one JSONL manifest with split = {train, calib, test} assigned by user_id hash.
  - (Tool names are standard open-source options; licenses were not re-verified in this session.)
- **Acceptance-check encoding.** A script computes the metrics in section 2 on the locked test split, with a cluster bootstrap by user (for example 2,000 resamples). It fails the build if:
  - the upper 95% CI of meal kcal MAPE is above the tier target;
  - |signed kcal bias| exceeds its threshold;
  - fat bias is below −15%;
  - 80%-interval coverage falls outside 75–85%;
  - any food-group stratum with n ≥ 30 regresses by more than 5 pp from the last baseline.
- **Leakage guards in CI.**
  - Assert no user_id, meal_id or perceptual-hash near-duplicate appears in both train/calib and test.
  - Assert the test manifest hash is unchanged (a frozen test set).
  - Rotate a fresh held-out batch periodically so the test set does not overfit.

### Gaps
- I did not confirm the MyFood license terms on Zenodo, or whether it has any weight or portion labels. I believe it does not, but did not verify.
- I did not confirm the MetaFood3D license for commercial use.
- I found no public Brazilian dataset with weighed ground truth and photos. Surveys of Brazilian university or hospital dietary studies (e.g., in Revista de Nutrição) were not searched.
- Annotation-tool licenses and the cost per annotated meal were not researched.

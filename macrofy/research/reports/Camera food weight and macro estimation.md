# Geometry, not LLMs, weighs the plate

**Build a native, on-device pipeline with no LLM in its core.** It has eight stages: a closed-vocabulary Brazilian food segmenter and embedding classifier; depth (LiDAR where the phone has it, otherwise monocular relative depth given metric scale by the ARKit/ARCore session); per-item volume; bulk density; grams; a TACO/USDA nutrient lookup that forces an explicit cooking state; one-tap confirmation of items and hidden oil; and calibrated ranges instead of bare numbers. LLMs are left out because gram error is a geometry problem, and that is where vision-language models are weakest. **GPT-4o and Claude miss food weight by 36–37% MAPE, and they under-count more as portions get bigger** ([PMC12513282](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/)). A small geometry head cuts that error by 33–41% ([arXiv 2607.16514](https://arxiv.org/abs/2607.16514)). The published evidence supports these targets: **about 20–30% per-item mass error from one photo, 12–18% with phone depth, 5–10% volume error with a short AR sweep, and about 12–15% per-meal kcal error once the user confirms items and oil**. No source supports a claim of under 10% per-meal kcal error from a single photo. Even hitting 20–30% beats the market leaders: a controlled 2026 NIH test found MyFitnessPal, Lose It!, Cal AI and Appediet **under-counting by 252–345 kcal per meal (about 33%) and about 30 g of fat** ([ScienceDaily](https://www.sciencedaily.com/releases/2026/07/260726015237.htm)). A cheap VLM is optional. Its only job would be long-tail recognition and hidden-fat flags, as a confidence-gated Gemini Flash-Lite call at roughly **$0.6–0.7 per 1,000 calls**. The two largest risks are not about models. First, the best Brazilian preparation table (TBCA) needs a commercial license, and the free one (TACO) under-counts cooking oil. Second, no Brazilian weighed-meal benchmark exists, so a 300-meal in-house benchmark must come first and gate every release.

## Capture mode sets the error floor, not model size

How the user captures the meal decides accuracy more than any model choice. The table gives the strongest published evidence for each capture mode, and a defensible v1 target synthesized from that evidence. One caveat applies to every number: Nutrition5k-style "PMAE" divides the mean error by the mean truth. That flatters results compared with the per-sample MAPE Macrofy should report, which is higher whenever small portions are present.

| Capture mode | Best published evidence | Realistic v1 target |
|---|---|---|
| One photo, VLM guesses grams | **Weight MAPE 36.3–37.3%, energy 35.8%** for GPT-4o and Claude 3.5 ([PMC12513282](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/)). ChatGPT-5 from the image alone: 30.5% energy MAPE ([Nutrients 2025](https://doi.org/10.3390/nu17223613)) | Not a product mode |
| One photo plus trained geometry (monocular depth, plate or AR scale) | Per-item mass **19.3–21.4% PMAE** on three real-world sets ([arXiv 2607.16514](https://arxiv.org/abs/2607.16514)). Nutrition5k in-distribution: kcal 14.7%, mass 10.6% PMAE ([DPF-Nutrition](https://arxiv.org/abs/2310.11702)). Multi-food volume with implicit scale: 21–23% MAPE ([arXiv 2602.13041](https://arxiv.org/abs/2602.13041)) | Item mass 20–30%; meal kcal 20–30% |
| One photo plus phone depth | iPhone X TrueDepth on 48 meals: **weight 14.0%, energy 12.7%, macros 12–15%** ([JMIR 2020](https://mhealth.jmir.org/2020/3/e15294/)). Nutrition5k depth-volume feature: kcal error 26.1%→16.5%, mass error 18.7%→13.7% ([arXiv 2103.03375](https://arxiv.org/pdf/2103.03375)) | Item mass 12–18%; meal kcal 15–20% |
| 5–15 s AR sweep (multi-view, metric poses) | **2.22% volume MAPE** from ARKit/ARCore poses with no reference object, on the authors' own data and not replicated ([VolE](https://www.nature.com/articles/s41598-026-38756-5)). About 11% with a checkerboard (MetaFood 2024 winner) ([VolETA](https://github.com/GCVCG/VolETA-MetaFood)) | Volume 5–10%; mass 10–15% |
| Any mode plus user confirmation | LLM energy MAPE **30.5%→13.9%** once given ingredients and amounts ([Nutrients 2025](https://doi.org/10.3390/nu17223613)). Exact food matches rose 46%→87% and intrusions fell 13%→0% ([Openfit](https://cdn.nutrition.org/article/S2475-2991(23)26593-2/fulltext)) | Meal kcal 12–15% |
| Human reference | Nutritionists about **41%** error and laypeople about 53% from photos ([Nutrition5k](https://arxiv.org/abs/2103.03375)). Fewer than one third of 38 professionals landed within ±10% ([PMC6115988](https://pmc.ncbi.nlm.nih.gov/articles/PMC6115988/)) | — |

Three mechanisms explain the ranking.

**Scale is cubed.** A global depth-scale error *s* becomes a volume error of (1+s)³−1. That turns the **10.7% MAPE of plate-size estimation** ([Frontiers 2020](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2020.519444/full)) into roughly −27% to +33% in grams. Metric scale from a sensor or from AR poses is therefore the single biggest lever.

**In-distribution benchmarks overstate field accuracy.** Models trained on generic objects lost about 70% accuracy on real food shapes ([MetaFood3D](https://arxiv.org/abs/2409.01966)). On ordinary phone photos, general LMMs beat an RGB-D fusion model trained on Nutrition5k ([PMC13401436](https://pmc.ncbi.nlm.nih.gov/articles/PMC13401436/)).

**Macros are always worse than mass.** On Nutrition5k, 10.6% mass error became **20–23% macro error** ([DPF-Nutrition](https://arxiv.org/abs/2310.11702)), because recognition and composition errors stack on top of portion error.

No published error budget exists. My synthesis of the ablations is: scale/volume about 15–25%, density 5–15%, recognition and hidden oil 10–25%, composition 5–10%. No study has yet run one phone pipeline through every capture mode on the same weighed dataset, so the targets above are extrapolated across benchmarks.

## A native on-device stack reads a plate in about 0.3 seconds

Every stage of the recommended pipeline has a commercially licensed open model with a measured phone latency. The per-model timings sum to about **150–300 ms for a five-item plate on a 2024–25 flagship**, with zero marginal cost per photo.

| Stage | Pick | License | Measured speed | Avoid |
|---|---|---|---|---|
| Item detection and instance masks | RF-DETR-Seg-N/S, fine-tuned on your own classes | Apache-2.0 | 3.4–4.4 ms on a T4 GPU; COCO mask AP 40.3–43.1 ([rf-detr](https://github.com/roboflow/rf-detr)) | YOLOE, YOLO26, FastSAM (AGPL: a closed app needs an Ultralytics license); YOLO-World (GPL) |
| Mask refinement | SAM 2.1-tiny | Apache-2.0 | Encoder 38–52 ms (W8A8, Galaxy S25), decoder 1–4 ms ([QAI Hub](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam2/perf.yaml)); 76 MB Core ML port | EdgeSAM (non-commercial license) |
| Food label | SigLIP 2 B/16 or CLIP ViT-B/16 embeddings plus a linear or k-NN head trained on Brazilian photos; text zero-shot for the long tail | CC-BY 4.0 weights / MIT | CLIP B/16: 17 ms on S25 ([QAI Hub](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/openai_clip/perf.yaml)) | MobileCLIP / MobileCLIP2 (weights are research-only) ([license](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)) |
| Relative depth (shape) | Depth Anything V2-Small, or DA3-Small | Apache-2.0 | **26 ms on iPhone 16 Pro, 19 MB palettized** ([Apple](https://developer.apple.com/machine-learning/models/)); 14.6–21.5 ms on S25 | DA V2 Base/Large, DA3 Large/Giant, UniDepth (all CC BY-NC) ([DA V2](https://github.com/DepthAnything/Depth-Anything-V2)) |
| LiDAR densification | Prompt Depth Anything-Small (25.1M params), which takes ARKit LiDAR as its prompt | Apache-2.0 code; weight license unverified | — | — |
| Server and training only | SAM 3/3.1 as a text-prompted auto-labeler for Brazilian photos; SfM meshing for AR sweeps | SAM License (commercial use allowed, with conditions) | SAM 3 backbone takes **1.3 s on S25**, so it is not a phone model ([QAI Hub](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam3/perf.yaml)) | Grounding DINO 1.5/1.6 Pro (paid API) |

Treat monocular *metric* depth models as priors only. Not one has published accuracy at 20–60 cm tabletop range, and DA3-Metric-Large's license is disputed between GitHub (Apache) and FiftyOne (CC BY-NC) ([DA3](https://github.com/ByteDance-Seed/Depth-Anything-3); [FiftyOne](https://docs.voxel51.com/model_zoo/models/depth_anything_v3_metric_large_torch.html)).

For training data, **Nutrition5k is CC BY 4.0 and allows commercial use** ([GitHub](https://github.com/google-research-datasets/Nutrition5k)). Food-101 and UEC-Food256 are restricted to fair use or non-commercial research ([UEC](http://foodcam.mobi/dataset256.html)). The only Brazilian set, MyFood, has 9 classes and no weights ([arXiv 2012.03087](https://arxiv.org/abs/2012.03087)). Brazilian training data will therefore be self-collected and auto-labeled with SAM 3.

### LiDAR is a bonus; the AR session is the foundation

LiDAR exists only on iPhone Pro models (12 Pro through 17 Pro), and hardware depth sensors (ToF) have all but disappeared from Android flagships ([Wikipedia](https://en.wikipedia.org/wiki/IPhone_17_Pro); [Android Authority](https://www.androidauthority.com/samsung-galaxy-s22-3d-tof-1218930/)). The default path must work without a depth sensor.

| Device class | Source of metric scale | Evidence and caveats |
|---|---|---|
| iPhone Pro / Pro Max | LiDAR `sceneDepth` with its confidence map, plus the AR plane; DA V2 shape rescaled to LiDAR | The map is 256×192, accurate to **±1 cm on objects larger than 10 cm, with about 2.05 cm RMSE and no gain from the 12 Pro to the 15 Pro** ([Sci Rep 2021](https://www.nature.com/articles/s41598-021-01763-9); [RSL 2026](https://www.tandfonline.com/doi/full/10.1080/2150704X.2026.2720055)). That is too coarse for 2–4 cm food heights, so use it for scale, the support plane and pose. It fails on soup, metal cutlery and aluminium marmitex trays, and it over-estimates granular rice ([survey](https://arxiv.org/html/2602.05078v1)) |
| Other iPhones and ARCore Android | ARKit/ARCore camera tracking (VIO poses) plus the detected table plane and intrinsics; no fiducial | The ARCore Depth API covers **87% of active Android devices**, but it is depth-from-motion and most accurate at 0.5–5 m, beyond plate distance ([ARCore](https://developers.google.com/ar/develop/depth)). Use it as a weak prior. No study has measured single-frame AR-plane scale error on tabletop food. This is the top Phase-0 experiment |
| No AR session | Plate diameter registered once by the user; a credit card as fallback | Relies on a plate prior, which lands at about ±30% volume error (see the scale arithmetic above) |
| High-accuracy mode | A 5–15 s sweep reconstructed on a self-hosted GPU | See the VolE row in the capture-mode table. Apple Object Capture runs on-device but targets single objects ([WWDCNotes](https://wwdcnotes.com/documentation/wwdc23-10191-meet-object-capture-for-ios/)) |

**Estimating volume from depth plus a mask:** fit the plate rim, not the table, because measuring from the table adds the plate's thickness under every item. Use container priors or a one-tap "small/medium/large bowl" for bowls. For liquids, use the rim plane plus the fill level. Feed geometric volume into a learned mass head as one input feature rather than trusting raw integration. This is the Nutrition5k depth-volume feature from the capture-mode table.

### Native is mandatory; a PWA is a demo

Safari on iPhone still has no handheld WebXR AR in 2026 ([caniuse](https://caniuse.com/webxr)), and the W3C abandoned depth streams in getUserMedia ([W3C](https://w3c.github.io/mediacapture-depth/)). A web app on iOS therefore gets neither LiDAR nor AR poses. WebGPU (Safari 26) also cannot reach the Neural Engine ([WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).

The recommended runtimes are Core ML on iOS today, moving to Apple's Core AI on iOS 27 ([InfoQ](https://www.infoq.com/news/2026/06/apple-core-ai-wwdc/)), and on Android either LiteRT with its NPU Compiled Model API or ONNX Runtime with the QNN execution provider ([LiteRT](https://github.com/google-ai-edge/LiteRT)). ExecuTorch fits a team that works PyTorch-first ([ExecuTorch](https://github.com/pytorch/executorch)). A React Native or Flutter shell works only with native modules for ARKit and ARCore.

## The nutrition lookup adds as much error as the camera

Even with perfect volume and correct identification, the data stage alone adds error. These are synthesized budgets combining component variances:

| Food | Data-stage error | Main driver |
|---|---|---|
| White rice | About ±13% kcal | Bulk density swings between **130 and 170 g per cooked cup** ([Chef's Resource](https://www.chefsresource.com/how-many-grams-in-1-cup-cooked-rice/)) |
| Grilled chicken | About ±12–16% | Fat content varies |
| Home-style arroz + feijão | −13% to +40% | Unseen refogado oil: 1 tbsp is about 120 kcal, roughly +30% on a 400 kcal portion |
| Dressed salad | Beyond ±50% | Lettuce type alone spans **28–72 g per cup** ([UF/IFAS](https://ask.ifas.ufl.edu/publication/HS1416)) |

Fat is both the least visible and the most variable macro. Its coefficient of variation exceeds 22%, against about 10% for protein, though that figure comes from an animal-feed analog ([Animal Bioscience](https://www.animbiosci.org/upload/pdf/15_239.pdf)). Frying adds 14% fat to fries and up to 40% to chips ([Heliyon](https://www.sciencedirect.com/science/article/pii/S240584402308708X)). On a Brazilian lunch plate, **a one-tap oil question is worth more than a depth sensor**.

| Source | Role | Commercial status | Watch-outs |
|---|---|---|---|
| TACO 4th ed. (NEPA/UNICAMP), 597 foods | Primary Brazilian table for raw and simple items | Reproduction allowed with citation, so it can be bundled ([NEPA](https://nepa.unicamp.br/publicacoes/tabela-taco-pdf/)) | Cooked rice lists **0.2 g fat per 100 g**, so it was apparently cooked without oil and under-counts home cooking |
| TBCA v7.2 (USP/FoRC): 5,700+ foods, 4,000+ preparations | As-eaten Brazilian preparations | Commercial use and alteration forbidden without the coordinators' permission ([TBCA](https://www.tbca.net.br/)) | Best fit for home cooking. **Negotiate a license early.** No confirmed bulk export |
| USDA FoodData Central, including FNDDS 2021–23 | Gap filler; FNDDS's ~22,000 portion weights double as bulk densities | **CC0**; API capped at 1,000 requests/hour, so ship an offline copy ([FDC](https://fdc.nal.usda.gov/api-guide)) | Also use USDA cooking-yield tables for raw↔cooked conversion ([USDA](https://www.ars.usda.gov/ARSUserFiles/80400535/Data/retn/USDA_CookingYields_MeatPoultry02.pdf)) |
| FAO/INFOODS Density DB v2.0, 638 entries | Cross-check densities | License unverified; FAO often uses non-commercial terms ([FAO](https://www.fao.org/fileadmin/templates/food_composition/documents/density_DB_v2_0_01.pdf)) | Derive densities from FNDDS instead |
| Open Food Facts, 3M+ products | Barcode lookup for packaged food | ODbL: attribution; share-alike applies to any derived database used publicly ([OFF](https://world.openfoodfacts.org/terms-of-use)) | Keep it in a separate store. Labels may legally be off by **±20%** ([ANVISA RDC 429/2020](https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/RDC_429_2020_.pdf)) |
| FoodOn and LanguaL facets | Language-neutral mapping of labels to IDs | FoodOn is CC BY 4.0 ([OBO](https://obofoundry.org/ontology/foodon)) | LanguaL license unverified |

Map labels without an LLM. Keep a closed vocabulary of about 200–500 classes weighted toward Brazilian food. Map each class by hand, once, to a TACO or FDC ID with **three mandatory facets: state (raw or cooked), method (grilled, fried or boiled) and default oil**. Missing facets, not synonyms, cause most mapping error: cooked chicken looked up as raw is off by about 30–40%, and raw rice looked up as cooked by about 3×. Map mixed dishes such as feijoada and strogonoff to a single as-eaten recipe entry. If TBCA stays unlicensed, compute those recipes from TACO/FDC ingredients plus a Brazilian default amount of oil.

## Cheap VLMs buy recognition, not grams — the market shows why

| Task | Use a VLM? | Evidence |
|---|---|---|
| Estimating grams | **Never** | Under-estimation grows with portion size (Bland–Altman slopes −0.23 to −0.50) ([PMC12513282](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/)). Answers vary between runs and plate arrangements ([JMIR Diabetes](https://doi.org/10.2196/102715)). Giving the model multiple views has negligible effect ([Sci Rep 2026](https://www.nature.com/articles/s41598-026-58755-w)) |
| Long-tail or regional dish names | Gated fallback | Gemini 3.1 Flash-Lite had the best ingredient recognition of 10 models tested (Jaccard 0.655) ([PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/)). All models struggle with cooking styles and look-alike foods ([FoodNExTDB](https://openaccess.thecvf.com/content/CVPR2025W/MTF/papers/Romero-Tapiador_Are_Vision-Language_Models_Ready_for_Dietary_Assessment_Exploring_the_Next_CVPRW_2025_paper.pdf)) |
| Grounding labels in a nutrient database | Useful if used at all | Retrieval over FNDDS cut weight and nutrient error by **63%** ([DietAI24](https://www.nature.com/articles/s43856-025-01159-0)) |
| Flagging hidden fat | Plausible but untested | In one informal benchmark, error rose 72% on dishes with oil or sauce drizzles ([GitHub](https://github.com/authrain-cloud-abdullahformuli/vlm-nutrition-benchmark)) |

| Option | Cost per 1,000 photos | Verdict |
|---|---|---|
| On-device Gemma 4 E2B/E4B or Qwen3-VL-2B/4B (Apache-2.0) | $0, but the app grows by hundreds of MB up to about 2 GB ([Gemma](https://en.wikipedia.org/wiki/Gemma_(language_model)); [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)) | No food benchmarks exist; test on your own benchmark before relying on it |
| Gemini 3.1 Flash-Lite ($0.25 / $1.50 per M tokens) | **$0.59 measured** ([PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/)) | Recommended gated fallback |
| Gemini 2.5 Flash-Lite ($0.10 / $0.40 per M tokens) | About $0.30 (my arithmetic) | Cheapest while still offered. Gemini 2.0 Flash shut down on 1 June 2026 ([forum](https://discuss.ai.google.dev/t/gemini-2-0-flash-discontinuation-date/131389)) |
| Gemini free tier | $0 | Evaluation only: content may be used to train Google's models ([billing docs](https://ai.google.dev/gemini-api/docs/billing)) |
| Frontier Claude or GPT models | About $20–60 ([CalorieBench](https://github.com/mmiddlezong/calorie-bench), informal) | No |

At 1,000 daily users taking 3 photos a day (about 90,000 photos a month), calling Flash-Lite on every photo costs roughly **$27–66 per month**. Gating to the ~20% of photos with low confidence cuts that to about **$5–13 per month** (my arithmetic). Keep output terse (labels, database IDs and flags only), turn thinking off and set temperature to 0.

| App | How it works | Claimed accuracy | Independent result |
|---|---|---|---|
| Cal AI (owned by MyFitnessPal since March 2026) | Cloud OpenAI and Anthropic models plus RAG ([TechCrunch](https://techcrunch.com/2025/03/16/photo-calorie-app-cal-ai-downloaded-over-a-million-times-was-built-by-two-teenagers/)) | 90% | **−345 kcal per meal** (NIH) |
| MyFitnessPal Meal Scan | Passio SDK plus a 14M-item database ([Passio](https://www.passio.ai/case-studies/myfitnesspal)) | — | −327 kcal per meal (NIH); 97% food identification ([Nutrients 2024](https://www.mdpi.com/2072-6643/16/15/2573)) |
| Lose It! Snap It | Its own neural network; the user picks the portion | — | −333 kcal per meal (NIH) |
| SnapCalorie | LiDAR on iPhone Pro plus human reviewers; founded by the Nutrition5k and Google Lens team | ±80 kcal on a 500 kcal dish with LiDAR, ±130 kcal without ([App Store](https://apps.apple.com/us/app/snapcalorie-nutrition-tracker/id1574239307)) | None found |
| PlateLens | — | 1.1% MAPE on an unverifiable web page ([DAI](https://dietaryassessmentinitiative.org/publications/six-app-validation-study-2026/)) | Contradicts every other source; ignore it |

The NIH result is a conference abstract (102 metabolic-kitchen meals) and has not yet been peer-reviewed ([Healio](https://www.healio.com/news/primary-care/20260804/ai-photobased-calorietracking-tools-underestimate-them-by-33)). Its message is still clear. **The market leaders win on low-friction UX, and their error is a systematic negative bias**, which a weighed benchmark can measure and correct. SnapCalorie is the only architectural peer, and its claim matches Nutrition5k's depth-pipeline 16.5%.

## A 300-meal weighed benchmark gates every phase

| Phase | Build | Exit gate on the locked test set (upper bound of the 95% CI) |
|---|---|---|
| 0. Benchmark and data | Collect 300 weighed meals from 10–20 households: 150 for development and calibration, 150 locked for test. Build the facet-mapped vocabulary. Start TBCA license talks. Auto-label Brazilian photos with SAM 3. Measure baselines: a zero-shot VLM and a Nutrition5k-trained model. Test AR-plane scale error at 25–40 cm | Test manifest frozen by hash; baselines recorded |
| 1. MVP single photo | Native on-device pipeline, AR/LiDAR scale, bulk densities derived from FNDDS, editable item chips | Meal kcal MAPE ≤30%; item mass MAPE ≤35%; signed kcal bias within ±10%; 80% prediction intervals (the ranges shown to users) cover 75–85% of true values |
| 2. Standard | One-tap hidden-fat prompts with fixed choices (free-text gram entry pushed error from 16% to 42% in Openfit) ([Openfit](https://cdn.nutrition.org/article/S2475-2991(23)26593-2/fulltext)). A portion slider anchored on the estimate and illustrated with household measures. LiDAR fusion. A learned mass head. Per-class bias correction. Conformal intervals (CQR) calibrated separately per food group and capture mode. A confidence gate | Meal kcal ≤20%; fat bias within ±15%; ≥40% of meals within ±10% and ≥70% within ±25%; LiDAR-subset item mass ≤18% |
| 3. Precision | Optional AR sweep; per-user calibration from occasional home weighings; gated Flash-Lite, added only if Phase-2 recognition recall falls short | Meal kcal ≤15%; item mass ≤20%; sweep volume ≤10% |

| Evaluation element | Specification |
|---|---|
| Ground truth | Follow the Nutrition5k incremental protocol ([GitHub](https://github.com/google-research-datasets/Nutrition5k)): tare the plate, add one item at a time, record grams, and photograph after each addition (overhead, 45°, and the user's natural handheld shot); weigh leftovers at the end. Use a 1 g / 5 kg scale plus a 0.1 g scale for oils and sauces. Weigh the pan oil and apportion it. For mixed dishes, weigh raw ingredients and the cooked yield. Check the scale each session against a reference mass. A kit costs about US$30–60. Comida-por-quilo receipts serve as coarse extra labels |
| Stratification | Angle (90°, 45–60°, 30°); distance 25–50 cm; lighting (daylight, warm indoor, dim, flash); plate type (white, patterned, dark, bowls, marmitex); occlusion (feijão over arroz); 2–3 phones with and without LiDAR. Record each factor as metadata |
| Leakage | Split by user and household. Keep every photo of a meal in one split. Deduplicate with perceptual hashes. Keep calibration and test sets separate. Rotate in fresh held-out batches |
| Metrics | Per-sample MAPE, not PMAE. MAE in grams and kcal; median APE; share within ±10/20/30%, where ±10% is the dietetic standard ([PMC6115988](https://pmc.ncbi.nlm.nih.gov/articles/PMC6115988/)). Signed bias. Macros in grams. Bland–Altman limits of agreement with exact CIs ([PMC5964973](https://pmc.ncbi.nlm.nih.gov/articles/PMC5964973/)). Recognition scored as exact, far, intrusion or omission. Items under 10 g scored in absolute grams. Day-level totals. Interval coverage and width. Oracle decomposition: ground-truth labels, then ground-truth mass, then end-to-end |
| Sample size | Assuming a standard deviation of ≈25 points in per-meal percentage error, the 95% CI half-width is **±4.9 points at n=100, ±3.5 at 200 and ±2.8 at 300** (my arithmetic). Use a cluster bootstrap by user with 2,000 resamples. Reserve at least 100 meals for conformal calibration ([Angelopoulos & Bates](https://arxiv.org/pdf/2107.07511)). Check coverage per food group only where n ≥ 30 |

## Conclusion

The gap in this category is bias and scale, not model size. The leaders lose about a third of calories to systematic under-counting of portions and fat. Paying for a bigger LLM fixes neither, but metric scale, a calibrated bias correction and an oil question each address one of them directly. That makes a no-LLM product both cheaper and *more* accurate than the incumbents, provided the Brazilian-specific parts are done well: facet-forced mapping, preparation data that includes oil, and a benchmark weighed on Brazilian plates.

Three bets decide the ceiling. The first is whether single-frame AR-plane scale holds at plate distance; nobody has measured it, so Phase 0 should. The second is TBCA licensing, a business decision that caps the accuracy of home-cooked meals. The third is honest ranges. No published food-portion system uses conformal prediction, so calibrated ranges that users can see are a real differentiator against apps that print a single confident, wrong number.

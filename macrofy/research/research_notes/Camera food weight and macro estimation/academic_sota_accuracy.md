# Academic state of the art: estimating food weight, volume, calories and macros from images (as of late Sept 2026)

*How these notes were sourced: the environment blocked full-text access to arXiv, CVF open access, PMC, MDPI, Nature and Google Sites. Only GitHub pages could be fetched. Most numbers below therefore come from search-engine extracts of the primary papers, and the primary-paper URL is cited for each. Where an extract looked conflated or contradicted another source, it is flagged. Metric warning: Nutrition5k-style "PMAE" / "MAE%" is MAE divided by the **mean** ground truth. It is not the per-sample MAPE used in the MetaFood / SimpleFood / LMM papers, and the two are not directly comparable. Per-sample MAPE is usually higher when small portions are present.*

---

## 1. Benchmark datasets and their ground truth (per-item vs per-dish labels)

### Takeaway
Nutrition5k is still the main per-dish benchmark (weighed, RGB-D, and it also has per-ingredient masses). The 2024–2026 datasets add per-item weights and 3D shape: MetaFood3D, the MetaFood challenge sets, SimpleFood45, NutritionVerse-Real, FPB, GT_Mensa_2025 and ACETADA. FoodSeg103 and UEC-FoodPix Complete are segmentation-only and have no weights.

### Cited Findings
**Weighed / nutrient-labelled datasets**
- **Nutrition5k (Google, CVPR 2021, older):** 5,006 plates from Google cafeterias in California. Each plate has 4 rotating side-angle videos (30° and 60° cameras, 90° apart) and an overhead RGB + depth image from a RealSense camera "when available", with depth stored as 16-bit and 10,000 units = 1 m. Metadata has **per-ingredient mass and macros plus dish totals**. Nutrients come from the USDA database. Incremental scans of the same plate stay in the same split. The authors acknowledge a geographic bias (a few California cafeterias only) — [GitHub: google-research-datasets/Nutrition5k](https://github.com/google-research-datasets/Nutrition5k)
- The Nutrition5k overhead-image subset used by most papers is about **3,500 images, 2,800 for training** — [OmniFood8K, arXiv 2604.12356](https://arxiv.org/html/2604.12356v1)
- A 2025 paper studies **data curation / label issues beyond the original Nutrition5k project** (title only; details not retrievable) — [PMC12252204](https://pmc.ncbi.nlm.nih.gov/articles/PMC12252204/)
- **MetaFood3D (Purdue, 2024):** v2 has **743 scanned 3D food objects in 131 categories**. Each object has a weight and an FNDDS food code, with nutrients per 100 g, so nutrients scale with actual weight. Modalities are textured meshes, RGB-D videos and segmentation masks. Models trained on generic uniform objects showed a **"nearly 70% drop in accuracy"** on MetaFood3D — [arXiv 2409.01966](https://arxiv.org/abs/2409.01966); [project page](https://lorenz.ecn.purdue.edu/~food3d/)
- The earlier MetaFood3D split used by PortionNet has **637 objects, 108 classes, 12,752 RGB images plus point clouds** — [PortionNet, arXiv 2512.22304](https://arxiv.org/html/2512.22304)
- **SimpleFood45 (CVPRW 2024):** 2D images of **45 food items with volume, weight and energy** labels — [Vinod et al., arXiv 2404.12257](https://arxiv.org/abs/2404.12257). The cross-dataset evaluation uses 513 images in 12 classes — [PortionNet](https://arxiv.org/html/2512.22304)
- **MetaFood CVPR 2024 challenge:** 20 food scenes in simple / medium / hard tiers; 16 teams. Phase I scored **volume MAPE** and Phase II scored **Chamfer distance** of meshes. Objects 1–14 were multi-view and objects 16–20 single-view — [challenge report, arXiv 2407.09285](https://arxiv.org/abs/2407.09285); [VolETA repo](https://github.com/GCVCG/VolETA-MetaFood)
- **MetaFood CVPR 2025 Challenge 1 ("3D Reconstruction From Monocular Multi-Food Images"):** **10 multi-food scenes and 24 3D objects**, with plates and utensils. **Explicit physical references and metric annotations were removed**, so scale must be inferred from plates and utensils. The scenes have frequent occlusions — [arXiv 2602.13041](https://arxiv.org/abs/2602.13041); [challenge page](https://sites.google.com/view/cvpr-metafood-2025/challenge-1); [Kaggle](https://www.kaggle.com/competitions/3d-reconstruction-from-monocular-multi-food-images)
- **MetaFood CVPR 2026 (3rd workshop, 3 June 2026, Denver):** **continuous / dynamic reconstruction** of food from **egocentric eating videos**, covering rotation, deformation, occlusion and breakage. Scored on 34 meshes by Chamfer distance — [LogMeal blog](https://blog.logmeal.com/continuous-3d-food-reconstruction-perbite-cvpr-2026/); [PerBite, arXiv 2606.02021](https://arxiv.org/abs/2606.02021); [MetaFood2026 site](https://sites.google.com/view/cvpr-metafood-2026)
- **ECUSTFD (2017, older):** **2,978 smartphone images of 19 food types**. Top and side views are paired, with a **1 CNY coin (25.0 mm)** as the calibration object, and there are **per-object weight and volume** labels. The authors avoided small foods such as peanuts because of large error — [GitHub Liang-yc/ECUSTFD-resized-](https://github.com/Liang-yc/ECUSTFD-resized-); [arXiv 1705.07632](https://arxiv.org/pdf/1705.07632)
- **NutritionVerse-Real (2024):** **889 images of 251 dishes and 45 food types**. **Every ingredient was weighed on a food scale**; composition comes from packaging or the Canadian Nutrient File. The mean dish is 830 kcal and 406.3 g. There are human segmentation masks and a 70/30 split by scene — [arXiv 2401.08598](https://arxiv.org/abs/2401.08598)
- **Food Portion Benchmark (FPB, IEEE Access 2025):** **14,083 images in 138 classes**, with bounding boxes and **laboratory-measured per-component weights in grams** (a YOLO label with a 6th weight column) — [GitHub IS2AI](https://github.com/IS2AI/Multitask-Food-Portion-Estimation); [HF dataset](https://huggingface.co/datasets/issai/Food_Portion_Benchmark)
- **GT_Mensa_2025 / vlm-food-benchmark (under review, 2026):** **200 canteen meal images with 870 weighed items** (314 unique descriptions, 1–7 items per image). Items were weighed on a kitchen scale with the plate tare subtracted. Images were taken on six people's own phones, with the longest side ≤748 px. The benchmark evaluates 2026-generation VLMs including Qwen3.5, Gemma 4, GPT-4.5 and Claude Sonnet 5, but numbers were not visible in the README — [GitHub Metabolic-Intelligence-Lab/vlm-food-benchmark](https://github.com/Metabolic-Intelligence-Lab/vlm-food-benchmark)
- **ACETADA (2025):** nutrient labels come from **weighed, dietitian-verified measurements**. It has paired **pre- and post-consumption smartphone images in free-living conditions**, from a controlled-feeding randomized crossover trial with **152 adults** in Perth — [arXiv 2507.07048](https://arxiv.org/abs/2507.07048); [dataset page](https://skynet.ecn.purdue.edu/~coburn6/ACETADA/)
- **OmniFood8K (CVPR 2026):** **8,036 food samples** with nutritional annotations and **multi-view images**, focused on Chinese dishes (5,600 for training) — [arXiv 2604.12356](https://arxiv.org/abs/2604.12356); [CVPR 2026 paper](https://openaccess.thecvf.com/content/CVPR2026/papers/Yu_OmniFood8K_Single-Image_Nutrition_Estimation_via_Hierarchical_Frequency-Aligned_Fusion_CVPR_2026_paper.pdf)
- **DonateAndLearn (ACM BCB 2025):** a phone-collected meal dataset used with Nutrition5k to benchmark 7 LMMs. It has 78 test cases — [PMC13401436](https://pmc.ncbi.nlm.nih.gov/articles/PMC13401436/)

**Segmentation-only datasets (no weights)**
- **FoodSeg103 (ACM MM 2021):** 7,118 images of 730 dishes with ingredient-level pixel masks (4,983 train / 2,135 test images; about 42k masks) — [arXiv 2105.05409](https://arxiv.org/pdf/2105.05409)
- **UEC-FoodPix Complete (ICPR 2020):** 10,000 images (9,000 train / 1,000 test) in 102 dish categories. Masks were made with GrabCut and then refined by hand. Masks cover whole dishes, not ingredients — [ResearchGate](https://www.researchgate.net/publication/349475604_UEC-FoodPix_Complete_A_Large-Scale_Food_Image_Segmentation_Dataset); [FoodSeg paper comparison](https://arxiv.org/pdf/2105.05409)

### Inferences
- **Per-item weight labels:** MetaFood3D, SimpleFood45, ECUSTFD, NutritionVerse-Real, FPB, GT_Mensa_2025 and ACETADA (weighed). Nutrition5k also has per-ingredient mass, but almost every published model regresses **per-dish totals** from it.
- **Per-dish totals are the main benchmark:** Nutrition5k and OmniFood8K (OmniFood8K granularity unverified).
- **Masks only, no weights:** FoodSeg103 and UEC-FoodPix Complete are only useful for training the segmentation stage.
- Only a few datasets combine real metric 3D with nutrients: MetaFood3D, the MetaFood challenge sets and Nutrition5k depth. The CVPR MetaFood track has moved from multi-view with a known scale (2024), to monocular with implicit scale (2025), to dynamic eating video (2026).

### Gaps
- Exact Nutrition5k counts could not be verified from the full text: the number of distinct ingredients, the share of plates with depth, and the test-split size.
- I found no dataset called "ACE" beyond ACETADA. It may be what the brief meant.
- I found no confirmed per-item label status for OmniFood8K.
- I found no large public dataset that has weighed per-item labels **and** phone LiDAR depth **and** diverse cuisines. The one partial exception is Nutrition5k's RealSense depth, which comes from cafeteria-only food.

---

## 2. Best reported errors: per-dish calories, per-dish mass, per-item mass, macros (with concrete numbers)

### Takeaway
- **On Nutrition5k (per-dish, in-distribution, overhead):** the best 2025–26 RGB-D models reach about **12% calorie PMAE and about 9% mass PMAE**, down from **26.1% calories for RGB-only in 2021**. Monocular RGB with predicted depth reaches about **15% calories and about 11% mass**. Macros are always worse, at about 20–23%.
- **Per-item mass on in-the-wild photos:** the best 2026 open-vocabulary system reaches about **19–21% PMAE** (MLLM plus a geometry head). Frontier MLLMs used alone sit at about **32–36%**.
- **Multi-view 3D reconstruction with known scale:** about **2–11% volume MAPE**. Monocular multi-food scenes with implicit scale only reach about **21–23% volume MAPE**.

### Cited Findings
**Per-dish, Nutrition5k (PMAE = MAE / mean)**
- **Nutrition5k RGB-only direct prediction (2021, older):** calories **70.6 kcal (26.1%)**, where the % is MAE as a percentage of the target mean — [GitHub Hashim-sawan (quoting the paper)](https://github.com/Hashim-sawan/deep-learning-food-nutrition-estimator). Aggregate macronutrient MAE was **31.9%** — [Liner review of Nutrition5k](https://liner.com/review/nutrition5k-towards-automatic-nutritional-understanding-generic-food)
- **Nutrition5k with depth as a 4th input channel (RGB-D):** calorie MAE falls **26.1% → 18.8%** and aggregate macro MAE **31.9% → 20.9%**. The same secondary source says the best end-to-end pipeline (volume → mass plus a portion-independent per-gram model) reached **16.5% calories and 26.2% aggregate macros**. These figures could not be reconciled with the full text, so treat them as secondary — [Liner review](https://liner.com/review/nutrition5k-towards-automatic-nutritional-understanding-generic-food); [paper](https://arxiv.org/abs/2103.03375)
- **DPF-Nutrition (Foods 2023): monocular at inference, with predicted depth from DPT fused with RGB.** PMAE: calories **14.7%**, mass **10.6%**, protein **20.2%**, fat **22.6%**, carbs **20.7%**; mean **17.8%**. The authors describe this as "competitive with RGB-D methods" — [arXiv 2310.11702](https://arxiv.org/abs/2310.11702); [PMC10706621](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10706621/)
- **IGSMNet (Foods, Oct 2025; RGB-D, ingredient-guided):** calories **12.2%**, mass **9.4%** PMAE on Nutrition5k. This is the best calorie/mass figure found — [doi 10.3390/foods14213697](https://doi.org/10.3390/foods14213697)
- **RGB-D with FLAVA contrastive learning (J. Food Comp. Anal., Dec 2025):** mean PMAE across all nutrients **14.43%**, against a previous best of **15.9%** — [ScienceDirect S0889157525016370](https://www.sciencedirect.com/science/article/pii/S0889157525016370)
- **RDINet (Applied Sciences, Jan 2026; RGB-D plus ingredients):** calories **14.9%**, mass **11.2%** PMAE — [doi 10.3390/app16010454](https://doi.org/10.3390/app16010454)
- **OmniFood8K (CVPR 2026):** single RGB image in, with depth predicted by Depth-Anything-V2 and refined by a scale-shift adapter. It reports the lowest PMAE on both OmniFood8K and Nutrition5k, and lower error on OmniFood8K because that set has about 2× the training data. Exact numbers were not retrieved — [arXiv 2604.12356](https://arxiv.org/html/2604.12356v1); [GitHub](https://github.com/yudongjian/OmniFood8K-food)
- **Pretraining study (Aug 2025):** on Nutrition5k 2D regression, JFT-300M-pretrained models "significantly outperform" ImageNet- and COYO-pretrained ViTs, and COYO pretraining did worse than ImageNet — [arXiv 2508.03996](https://arxiv.org/abs/2508.03996)

**Per-item mass (grams)**
- **Geometry-Enhanced Portion Estimation for MLLMs (July 2026).** A frozen commercial MLLM supplies the food name, box and density range, and a small head on DINOv2 estimates volume. No depth sensor is used. **Per-food** results, head vs MLLM alone:
  - **Nutrition5k:** **16.7 g / 21.4% PMAE** vs 28.1 g / 36.1%
  - **FPB:** **43.6 g / 19.3%** vs 66.9 g / 31.8%
  - **NutritionVerse-Real:** **27.4 g / 21.0%** vs 41.0 g / 33.1%
  - That is a 33–41% error reduction. Gemini-3.5-Flash had the best direct portion accuracy among the flagship models benchmarked (Gemini, GPT, Claude).
  - — [arXiv 2607.16514](https://arxiv.org/abs/2607.16514)
- **FPB original multitask YOLO (2025):** per-item weight **MAE 90.95 g**, with detection mAP50 0.978 — [ResearchGate / IEEE Access](https://www.researchgate.net/publication/395082924_A_Multitask_Deep_Learning_Model_for_Food_Scene_Recognition_and_Portion_Estimation_-_the_Food_Portion_Benchmark_FPB_dataset)
- **RGB + depth camera, YOLO, per-food density models (Sensors 2024, institutional cafeteria):** weight error **5.07% for rice and 3.75% for chicken**, and **<5.1%** on real cafeteria items. This is a fixed-rig, closed-menu setting — [Sensors 24(23):7660](https://www.mdpi.com/1424-8220/24/23/7660); [PMC11644939](https://pmc.ncbi.nlm.nih.gov/articles/PMC11644939/); [Phase 2, Sensors 2026](https://doi.org/10.3390/s26010076)
- **iPhone X structured-light depth app (JMIR mHealth 2020, older).** Relative absolute error vs weighed meals:
  - **weight 14.0%**, **energy 12.7%**
  - carbs 14.8%, fat 12.3%, protein 13.0%
  - Accuracy was lower for cooked meals than for snacks and breakfast.
  - — [JMIR mHealth 2020;8(3):e15294](https://mhealth.jmir.org/2020/3/e15294/)

**Volume / energy with 3D priors or reconstruction (per item)**
- **3D object scaling (template-based, CVPRW 2024):** energy **31.10 kcal (17.67% MAPE)** on SimpleFood45 — [arXiv 2404.12257](https://arxiv.org/abs/2404.12257)
- **MFP3D (monocular point cloud, 2024):** **24.03% energy MAPE** on SimpleFood45. On MetaFood3D it scored **41.43% volume MAPE and 68.05% energy MAPE**, as reported by PortionNet — [arXiv 2411.10492](https://arxiv.org/abs/2411.10492); [PortionNet](https://arxiv.org/html/2512.22304)
- **PortionNet (Dec 2025):** point-cloud knowledge is distilled into an RGB-only model. Results: **17.43% volume MAPE and 15.36% energy MAPE** on MetaFood3D, and **12.17% energy MAPE** on SimpleFood45 — [arXiv 2512.22304](https://arxiv.org/abs/2512.22304)
- **MetaFood 2024 (multi-view, known scale).**
  - One extract says **VolETA** (Pixel-Perfect SfM + SAM + XMem++ + NeuS2) scored **MAPE 0.0719 on multi-view** objects 1–14 and **0.0587 on single-view** objects 16–20 — [search extract of arXiv 2407.09285](https://arxiv.org/abs/2407.09285). VolETA's own repo instead reports a **Phase-I MAPE of 0.10973** and a Chamfer distance of 0.007259 (with transformation) — [GitHub VolETA](https://github.com/GCVCG/VolETA-MetaFood). *These two sources conflict.*
  - **FoodRiddle** (SfM with SuperPoint/SuperGlue, 2D Gaussian Splatting, and an AIGC multi-view generator for single-view objects) had the best overall score. Average Chamfer across the 20 final objects was 0.0032 m — [arXiv 2407.09285](https://arxiv.org/abs/2407.09285); [GitHub FoodRiddle](https://github.com/jlyw1017/FoodRiddle-MetaFood-CVPR2024)
- **VolE (Sci. Reports 2026; ARKit/ARCore camera poses, no reference object and no depth sensor):** **2.22% volume MAPE** on the MetaFood (MTF) dataset and 1.22% mean error on Foodkit — [arXiv 2505.10205](https://arxiv.org/abs/2505.10205); [Nature Sci Rep](https://www.nature.com/articles/s41598-026-38756-5)
- **MetaFood 2025 (monocular, multi-food, implicit scale):** the top approach scored **0.21 volume MAPE** and an L1 Chamfer of 5.7 — [arXiv 2602.13041](https://arxiv.org/abs/2602.13041). **MonoBite** reports **0.23 MAPE** and Chamfer 5.85, and claims first place — [Springer PRCV](https://link.springer.com/chapter/10.1007/978-981-95-5737-0_3). The challenge page lists "Team Hillo World" 1st, "OneVol" 2nd and "wuhu648648" 3rd — [challenge page](https://sites.google.com/view/cvpr-metafood-2025/challenge-1). *The mapping between team names and papers is not confirmed.*
- **MetaFood 2026 (dynamic eating video):** **PerBite (LogMeal / UB)** ranked 1st with an average Chamfer of **8.31 over 34 meshes**. Its pipeline:
  - SAM 3 segments food and plate
  - Hunyuan3D / SAM 3D generates a mesh with no metric scale
  - the **plate diameter sets the metric scale**
  - the mesh is made watertight and its volume integrated
  - No volume-MAPE figure was found — [LogMeal blog](https://blog.logmeal.com/continuous-3d-food-reconstruction-perbite-cvpr-2026/)

**Large multimodal models (per meal, calories/macros)**
- **ChatGPT-5 (Nutrients 2025), 195 dishes** (Allrecipes, SNAPMe and home-weighed):
  - energy MAPE **30.51%** from the image alone, **24.35%** with non-visual descriptors, **13.92%** with an ingredient list and amounts
  - energy MAE **123.0 → 92.0 → 53.3 kcal** across the same three conditions
  - — [doi 10.3390/nu17223613](https://doi.org/10.3390/nu17223613)
- **ChatGPT-4o:** **35.8% energy MAPE** on standardized photos, with **up to 54.4%** on complex meals before extra information was added. **GPT-4.1 given the ground-truth weight reached 26.8% MAPE.** The search extracts mix these figures across [ScienceDirect S088915752501659X](https://www.sciencedirect.com/science/article/pii/S088915752501659X) and [ACETADA, arXiv 2507.07048](https://arxiv.org/abs/2507.07048). *Exact attribution is unverified.*
- **DonateAndLearn (BCB 2025).** Out of domain, full-size LMMs **significantly outperformed an RGB-D fusion model** trained on Nutrition5k. Gemini 2.5 Flash **carb MAPE fell from 56.6% to 39.5%** when it was given a predicted weight (n = 78) — [PMC13401436](https://pmc.ncbi.nlm.nih.gov/articles/PMC13401436/)

**Human baselines**
- **Calories estimated from food images:** nutritionists average **41%** error, non-nutritionists **53%**. The search extracts attribute this to the Nutrition5k human comparison, which I could not verify from the full text. Nutrition5k models are reported to **outperform professional nutritionists** — [Nutrition5k paper](https://arxiv.org/abs/2103.03375); [Dearstyne et al. 2023](https://arxiv.org/abs/2306.09527)
- **38 nutrition professionals estimating portions from digital images:** error **44.3 ± 16.6%** for food in bowls, and higher on plates. **Fewer than one third** were within 10% — [Nutrients 2018, PMC6115988](https://pmc.ncbi.nlm.nih.gov/articles/PMC6115988/)
- **Future dietitians after a short training (2007, older):** median error **14.18% for liquids, 14.51% for solids and 33.96% for amorphous foods** — [Arch. Latinoam. Nutr. 2007](https://www.alanrevista.org/ediciones/2007/2/art-9)
- **Remote Food Photography Method (trained analysts reviewing photos; older, 2012–2017):**
  - Adults: underestimates energy by **<6% in the lab and <7% free-living vs weighed food**, and **<4% vs doubly labeled water** over 6 days — [PubMed 22134199](https://pubmed.ncbi.nlm.nih.gov/22134199/)
  - Minority preschoolers: **−15.6%** vs DLW — [PubMed 28758370](https://pubmed.ncbi.nlm.nih.gov/28758370/)
  - Adolescents: accurate in the cafeteria, but **−888 kcal/day** over 7 free-living days — [PubMed 42501948](https://pubmed.ncbi.nlm.nih.gov/42501948/)

### Inferences
- Rough **per-dish calorie error** ranking by setting:
  - trained RGB-D, in distribution: ≈12–19%
  - monocular with predicted depth, in distribution: ≈15%
  - frontier LMM on arbitrary photos: ≈30–36%
  - trained dietitian eyeballing a photo: ≈40%
  - trained human analysts with protocol and recipe context (RFPM): <7% aggregated over days (averaging cancels error; single meals are much worse)
- In-distribution Nutrition5k numbers overstate real-world accuracy. DonateAndLearn showed an RGB-D fusion model losing to general LMMs out of domain, and MetaFood3D showed a ~70% accuracy drop for models trained on generic objects.
- Mass is consistently easier than macros: about 9–11% mass PMAE vs 20–23% for fat, carbs and protein on Nutrition5k. So even a perfect weight leaves about 10–25% nutrient error from recognition and composition. GPT-4.1 still had about 27% calorie MAPE when given the true weight.

### Gaps
- The Nutrition5k full-table values could not be verified: per-metric grams for RGB vs RGB-D, the exact nutritionist table and the size of the nutritionist sample.
- The exact MetaFood 2024 per-team volume MAPE (FoodRiddle vs VolETA vs ININ-VIAUN) is unresolved because the sources conflict.
- I found no MetaFood 2026 volume-MAPE number.
- I found no per-item mass error for MetaFood 2025 converted to grams.
- The OmniFood8K PMAE numbers were not retrieved.
- The GT_Mensa_2025 VLM results were not published in the README.

---

## 3. Which method families win, and under what conditions

### Takeaway
- **With known metric scale:** multi-view or AR-posed reconstruction wins on volume, at about 2–11% MAPE.
- **With a single image:** the best systems in 2025–26 are hybrids. They use depth predicted from RGB, or 3D knowledge distilled into an RGB model, or an MLLM for recognition plus a trained geometry head for portion. These reach about 15–21%.
- Pure end-to-end RGB regression and pure prompting of an LMM are the weakest options for portion estimation.

### Cited Findings
- **Direct RGB regression:** Nutrition5k 26.1% calories in 2021, falling to about 15% with modern backbones and predicted depth (DPF-Nutrition). Pretraining data matters a lot (JFT-300M > ImageNet > COYO) — [DPF-Nutrition](https://arxiv.org/abs/2310.11702); [arXiv 2508.03996](https://arxiv.org/abs/2508.03996)
- **Predicted depth ≈ measured depth on the benchmark:** DPF-Nutrition's monocular predicted depth (14.7% calories) is "competitive with RGB-D methods". OmniFood8K (CVPR 2026) also uses Depth-Anything-V2 instead of a sensor — [DPF](https://arxiv.org/abs/2310.11702); [OmniFood8K](https://arxiv.org/abs/2604.12356)
- **RGB-D regression is best in distribution:** IGSMNet reaches 12.2% calories and 9.4% mass — [IGSMNet](https://doi.org/10.3390/foods14213697)
- **Segmentation + depth → volume → density → mass, with a fixed RGB-D rig and per-food density tables:** <5.1% weight error on a cafeteria menu — [Sensors 2024](https://www.mdpi.com/1424-8220/24/23/7660). A phone depth sensor (iPhone X) gave 14.0% weight and 12.7% energy error — [JMIR 2020](https://mhealth.jmir.org/2020/3/e15294/)
- **Multi-view 3D reconstruction (SfM / NeuS2 / 2D Gaussian splatting) with known scale:** about 6–11% volume MAPE in MetaFood 2024. AR-pose multi-view (VolE) reached 2.22% — [VolETA](https://github.com/GCVCG/VolETA-MetaFood); [VolE](https://arxiv.org/abs/2505.10205)
- **Monocular 3D with implicit scale (plate or utensil):** 21–23% volume MAPE. Geometry-based reconstruction was "more accurate and more robust" than the alternatives — [arXiv 2602.13041](https://arxiv.org/abs/2602.13041); [MonoBite](https://link.springer.com/chapter/10.1007/978-981-95-5737-0_3)
- **Generative image-to-3D plus plate-diameter scale won MetaFood 2026:** SAM 3 + Hunyuan3D / SAM 3D — [LogMeal](https://blog.logmeal.com/continuous-3d-food-reconstruction-perbite-cvpr-2026/)
- **Template / shape priors:** 3D object scaling reached 17.67% energy MAPE on single foods — [arXiv 2404.12257](https://arxiv.org/abs/2404.12257)
- **3D→2D distillation:** PortionNet reached 15.36% energy and 17.43% volume MAPE with RGB only at inference, beating MFP3D's 68.05% and 41.43% — [arXiv 2512.22304](https://arxiv.org/abs/2512.22304)
- **MLLM recognition + geometry head:** 19–21% per-item PMAE on three real-world sets, vs 32–36% for the MLLM alone. MLLMs are "weak at portion estimation" but strong at zero-shot recognition — [arXiv 2607.16514](https://arxiv.org/abs/2607.16514)
- **Conditions where methods fail:**
  - Phone LiDAR fails on reflective or transparent surfaces (soup, metal cutlery), degrades outdoors because of IR interference, and has low accuracy on small objects — [search summary citing Springer LiDAR paper](https://link.springer.com/chapter/10.1007/978-981-95-4398-4_10)
  - Granular foods (rice, nuts) are over-estimated because the depth surface fills the air gaps between particles (a "convex hull" effect) — [LiDARCalorieCam slides](http://mm.cs.uec.ac.jp/pub/conf25/251111fujita_3_ppt.pdf); [survey arXiv 2602.05078](https://arxiv.org/abs/2602.05078)
  - Cooked or mixed meals were less accurate than snacks and breakfast — [JMIR 2020](https://mhealth.jmir.org/2020/3/e15294/)
  - Amorphous foods were about 2.4× harder for humans than solids or liquids (34% vs 14%) — [alanrevista 2007](https://www.alanrevista.org/ediciones/2007/2/art-9)
  - MetaFood 2025 was hard partly because of frequent occlusions in multi-food scenes — [arXiv 2602.13041](https://arxiv.org/abs/2602.13041)

### Inferences
- For a phone app, pick the family by the situation:
  - **(i) single item, or a plate with a visible rim:** monocular geometry plus a plate or known-object scale prior, with MLLM recognition
  - **(ii) LiDAR present:** measured depth → volume → per-class density
  - **(iii) user willing to move the phone:** an AR-pose short sweep, which is the only route to single-digit volume error
- End-to-end calorie regression trained on Nutrition5k should not be the core. It is cafeteria-biased and fragile out of domain.
- Liquids in opaque containers, sauces and stacked or occluded food are not solved by any family. Every family needs a container-template or user-input fallback for these.

### Gaps
- No paper was found that reports error separately for liquids, sauces or stacked food on a common benchmark.
- There is no head-to-head test of LiDAR vs monocular predicted depth on the same weighed phone dataset.
- The performance of Gaussian-splatting methods in isolation, beyond FoodRiddle's pipeline, was not quantified.

---

## 4. Dominant error sources and error budgets

### Takeaway
- **Scale ambiguity** is the biggest single error source for monocular methods. Hidden volume or occlusion comes next, then density.
- **Recognition and nutrient composition** cause an irreducible 10–27% of calorie error even when weight is known, much of it from hidden fats and oils.
- No published end-to-end error budget was found. The partial budgets below come from ablation-style evidence.

### Cited Findings
- **Scale is "the most persistent challenge in monocular estimation".** Without a reference, the mapping from pixels to 3D is indeterminate. Fiducial markers solve it but disrupt the user experience, and deep-learning scale prediction fails on in-the-wild images. The survey also names three critical bottlenecks as still unsolved — [Vinod & Zhu survey, arXiv 2602.05078](https://arxiv.org/abs/2602.05078)
- **Removing explicit scale references** (MetaFood 2025) pushed the best volume MAPE to 0.21, against roughly 0.06–0.11 with references and multi-view in 2024 — [2602.13041](https://arxiv.org/abs/2602.13041); [VolETA](https://github.com/GCVCG/VolETA-MetaFood)
- **Food geometry is out of distribution for generic 3D models:** a ~70% accuracy drop on MetaFood3D — [arXiv 2409.01966](https://arxiv.org/abs/2409.01966)
- **Density varies strongly within a category** (croissant vs bagel), and density tables have to be calibrated per food — [Sensors 2024 / survey summary](https://pmc.ncbi.nlm.nih.gov/articles/PMC11644939/); [JMIR scoping review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11607557/)
- **Recognition and recipe uncertainty (LMM ablation):** adding the ingredient list and amounts cut ChatGPT-5 energy MAPE **from 30.5% to 13.9%**. Adding only non-visual descriptors cut it to 24.4% — [Nutrients 2025](https://doi.org/10.3390/nu17223613)
- **Portion is the main LMM weakness:** a geometry head cuts MLLM per-food error by 33–41% — [2607.16514](https://arxiv.org/abs/2607.16514)
- **Supplying weight to an LMM** reduces carb MAPE from 56.6% to 39.5% (Gemini 2.5 Flash) — [PMC13401436](https://pmc.ncbi.nlm.nih.gov/articles/PMC13401436/). GPT-4.1 with the true weight still had 26.8% calorie MAPE — [arXiv 2507.07048](https://arxiv.org/abs/2507.07048) (attribution unverified)
- **Nutrient-database variance:** lab analysis vs database estimates agreed for energy and fat, but **protein was higher by lab analysis by +13 ± 2% and +25 ± 5%** in two research diets — [PubMed 42609813](https://pubmed.ncbi.nlm.nih.gov/42609813/)
- Composition error is classified as true random variability of foods, biased composition data, and bioavailability differences — [NCBI Bookshelf NBK217524](https://www.ncbi.nlm.nih.gov/books/NBK217524/)
- **Hidden fats:** 1 tbsp olive oil ≈ 119 kcal. Commercial sources claim AI tools under-estimate homemade meals by 15–40% because fats and sugars cannot be seen. *These are commercial blogs, not peer-reviewed, so treat them as low-quality* — [CalScan blog](https://calscanai.com/blog/why-ai-food-scanner-might-be-lying-about-calories/); [Amy Food Journal](https://www.amyfoodjournal.com/blog/is-ai-calorie-counting-accurate)
- **Macro vs mass gap on Nutrition5k:** DPF-Nutrition has 10.6% mass PMAE but 20–23% for macros. Recognition and composition roughly double the error on top of mass — [DPF-Nutrition](https://arxiv.org/abs/2310.11702)
- **Phone depth hardware limits:** iPhone LiDAR point-cloud RMSE is about **2.05–2.06 cm** vs validation shapes (iPhone 12 Pro / 15 Pro, objects 0.8–42.5 cm). That is coarse relative to food height — [Remote Sensing Letters 2026](https://www.tandfonline.com/doi/full/10.1080/2150704X.2026.2720055)

### Inferences
Approximate **per-meal calorie error budget for monocular RGB in the wild**. This is my synthesis, not a published budget:
- **scale / volume:** about 15–25%
- **density:** about 5–15%
- **recognition / ingredient ambiguity, including hidden oil:** about 10–25%
- **composition database:** about 5–10%, with protein worst

These combine sub-additively to the observed 25–35% calorie MAPE for LMMs.

### Gaps
- No peer-reviewed study was found that quantifies hidden-oil or sauce error with images against weighed recipes.
- No formal error decomposition was found (for example, an oracle-segmentation / oracle-scale / oracle-density ablation) on a single benchmark.
- No density-variance statistics per food class were retrieved.

---

## 5. Realistic, defensible v1 accuracy targets by capture mode

### Takeaway
Defensible v1 targets:
- **Monocular RGB:** per-item mass MAPE of about **20–30%**, per-meal kcal of about **20–30%**
- **LiDAR / phone depth:** per-item mass of about **12–18%**, per-meal kcal of about **15–20%**
- **Multi-view AR sweep:** per-item volume of about **5–10%**, which becomes about **10–15% mass** once density error is added
- **User-in-the-loop confirmation** (items, hidden fats, container): per-meal kcal of about **12–15%**

Claims of below 10% per-meal kcal from a single photo are not supported by the literature.

### Cited Findings (evidence anchors per mode)
- **(a) Monocular RGB only:**
  - best per-item mass **19.3–21.4% PMAE** (MLLM + geometry head) and **32–36%** for the MLLM alone — [2607.16514](https://arxiv.org/abs/2607.16514)
  - per-meal energy MAPE **30.5%** (ChatGPT-5, image only) — [Nutrients 2025](https://doi.org/10.3390/nu17223613); **35.8%** (GPT-4o) — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S088915752501659X)
  - Nutrition5k in-distribution calories **14.7%** (DPF) — [DPF](https://arxiv.org/abs/2310.11702)
  - single-food energy **12–18% MAPE** with 3D priors — [PortionNet](https://arxiv.org/abs/2512.22304); [3D scaling](https://arxiv.org/abs/2404.12257)
  - monocular multi-food volume **21–23%** — [2602.13041](https://arxiv.org/abs/2602.13041)
- **(b) Phone depth / LiDAR:**
  - iPhone X depth app: weight **14.0%**, energy **12.7%** — [JMIR 2020](https://mhealth.jmir.org/2020/3/e15294/)
  - RGB-D on Nutrition5k: mass **9.4%**, calories **12.2%** — [IGSMNet](https://doi.org/10.3390/foods14213697)
  - fixed RGB-D cafeteria rig: **<5.1%** — [Sensors 2024](https://www.mdpi.com/1424-8220/24/23/7660)
  - LiDAR failure modes: reflective or transparent surfaces, granular foods, small objects — [LiDARCalorieCam](http://mm.cs.uec.ac.jp/pub/conf25/251111fujita_3_ppt.pdf)
- **(c) Multi-view capture:**
  - AR-pose multi-view volume MAPE **2.22%** — [VolE](https://arxiv.org/abs/2505.10205)
  - challenge-grade multi-view **≈6–11%** — [VolETA](https://github.com/GCVCG/VolETA-MetaFood); [2407.09285](https://arxiv.org/abs/2407.09285)
- **(d) User-in-the-loop:**
  - an ingredient list with amounts took LMM energy MAPE to **13.9%** (MAE 53 kcal) — [Nutrients 2025](https://doi.org/10.3390/nu17223613)
  - trained-analyst photo review (RFPM) reached **<6–7%** energy error in adults — [PubMed 22134199](https://pubmed.ncbi.nlm.nih.gov/22134199/)
  - untrained or professional visual estimation from images: **41–53%** — [2306.09527](https://arxiv.org/abs/2306.09527); **44%** — [PMC6115988](https://pmc.ncbi.nlm.nih.gov/articles/PMC6115988/)

### Inferences
- **Recommended core approach, from the evidence:**
  1. An MLLM (or a fine-tuned detector) handles open-vocabulary item recognition and a density range.
  2. A dedicated geometry/portion module estimates per-item volume, using monocular depth (Depth-Anything-class) plus plate or utensil scale priors.
  3. LiDAR depth is fused when available. An optional 2–3 second AR sweep enables multi-view.
  4. Per-class density and the composition database are applied last.
  5. The UI asks the user to confirm items, cooking fat and sauces, and to correct the portion. Confirmation plausibly gives the largest single error reduction (≈30% → ≈14% energy MAPE in the ChatGPT-5 ablation).
- **Report in the per-sample MAPE convention**, not Nutrition5k-style PMAE, which divides by the mean and looks better. Also report the share of items within ±20%.
- **Beating dietitians' visual estimates (≈40%) is achievable even monocularly.** Matching weighed records (<10%) is not, except with a multi-view/AR capture of simple, rigid foods.

### Gaps
- No published study was found that measures a full phone pipeline end to end on per-item grams **and** per-meal kcal under all four capture modes on the same weighed dataset.
- The targets above are therefore extrapolated across different benchmarks and metric conventions (PMAE vs MAPE).
- No peer-reviewed evaluation of the leading commercial apps (SnapCalorie etc.) against weighed ground truth was retrieved.

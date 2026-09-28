# VLMs for photo-based food weight/macro estimation, and how commercial apps do it (as of late Sep 2026)

Research note for Macrofy. Scope: (1) whether a vision-language model (VLM/LLM) is needed or useful, and the cheapest way to use one; (2) what commercial apps use and how accurate they measurably are.

Method caveat: most primary pages (PMC, PubMed, arXiv, bioRxiv, ai.google.dev, Hugging Face, publisher sites) were blocked for direct fetch from this environment. Figures below come from search-engine extracts of those pages plus the GitHub pages that could be fetched. Each figure links the primary URL it came from. Where only an aggregator or vendor blog carried a figure, that is flagged. Where figures conflict, both are given.

Reliability tags used below:
- **[peer-reviewed]**: journal or conference paper.
- **[preprint]**: arXiv or bioRxiv, not yet peer-reviewed.
- **[abstract]**: conference abstract, not peer-reviewed.
- **[informal]**: GitHub hobby benchmark or third-party review site.
- **[vendor claim]**: marketing or company-authored.
- **[older]**: data from before 2025.

---

## Q1. Published evaluations of VLMs/LLMs on food nutrition from photos: accuracy, VLM vs dedicated CV on portion size, systematic biases

### Takeaway
- **Recognition:** frontier VLMs are good at naming the foods on a plate, and they generalize to phone photos better than in-domain CV models do.
- **Grams:** they are poor at portion mass. Weight MAPE is about 35–37% for the best general models, errors grow with portion size, and repeated runs on the same meal disagree.
- **Where the accuracy comes from:** adding geometry (depth, volume, a trained portion head) or user-supplied amounts is what brings errors down to roughly 15–20%.
- **Bias:** consistent underestimation of large portions and of fat.

### Cited Findings

**Large multi-model benchmarks**

- **10-model benchmark on Nutrition5k** [peer-reviewed; bioRxiv 26 Jul 2026, then PMC]
  - Setup: 3,229 Nutrition5k images, ten approaches:
    - Gemini 2.0 Flash, 2.5 Flash, 3.0 Flash, 3.1 Flash-Lite
    - GPT-4o, GPT-4o-mini, GPT-5 Mini
    - Claude Haiku 4.5
    - open-source Qwen2-VL-7B
    - FatSecret's commercial food-recognition API
  - Metrics: Lin's CCC for calories and weight; Jaccard similarity for ingredient detection.
  - Best calories: Gemini 3.0 Flash, CCC 0.767, **MAE 80.7 kcal**.
  - Gemini 3.1 Flash-Lite: CCC 0.754, **best ingredient recognition (Jaccard 0.655)**, **$0.59 per 1K images**, the cheapest of the top performers.
  - Gemini 2.0 Flash: CCC 0.742, Jaccard 0.621, **$0.10 per 1K images**.
  - Sources: [PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/); [bioRxiv](https://www.biorxiv.org/content/10.64898/2026.07.26.740845v1)
- **Label quality in that benchmark:** four annotators reviewed 440 images and found systematic omissions in the original Nutrition5k labels. After correction, Gemini 2.0 Flash's estimated ingredient overlap rose from 0.62 to about 0.82, so raw Jaccard scores understate VLM recognition. — [PubMed 42619751](https://pubmed.ncbi.nlm.nih.gov/42619751/)
- Not retrieved from that paper: per-model weight MAE in grams, and the Qwen2-VL-7B and FatSecret numbers (see Gaps).

**Studies that report weight error directly**

- **GPT-4o vs Claude 3.5 Sonnet vs Gemini 1.5 Pro** [peer-reviewed; *Current Developments in Nutrition*, 2025]
  - Setup: 52 standardized photos (16 single foods, 36 meals) in small, medium and large portions, with cutlery and plates visible as size references. Reference values from weighing plus the Dietist NET database.
  - **Weight MAPE:** GPT-4o 36.3%, Claude 37.3%.
  - **Energy MAPE:** 35.8% for both.
  - Gemini 1.5 Pro: 64.2–109.9% MAPE across nutrients.
  - Correlations: r = 0.65–0.81 for GPT-4o and Claude.
  - **All models systematically underestimated, and the underestimate grew with portion size (Bland–Altman bias slopes −0.23 to −0.50).**
  - Sources: [PMC12513282](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/); [PubMed 41081011](https://pubmed.ncbi.nlm.nih.gov/41081011/)
- **ChatGPT-5 across four context levels** [peer-reviewed; *Nutrients* 2025, 17(22):3613]
  - Setup: 195 dishes from Allrecipes, SNAPMe and home-weighed meals.
  - **Image only: MAE 123.0 kcal and 7.9 g protein.**
  - Accuracy improved stepwise when non-visual descriptors were added, then again with ingredient lists including amounts.
  - Source: [doi 10.3390/nu17223613](https://doi.org/10.3390/nu17223613)
- **Seven large multimodal models (full and lightweight GPT, Gemini, Llama) on Nutrition5k plus phone photos** [peer-reviewed; ACM BCB '25, Mu, Sun & He]
  - On their phone-collected DonateAndLearn set, full-size LMMs significantly outperformed an RGB-D fusion model trained on Nutrition5k. The authors read this as better generalization.
  - Feeding a predicted weight into Gemini 2.5 Flash cut carbohydrate MAPE from 56.6% to 39.5% (n=78).
  - Sources: [ACM DL](https://doi.org/10.1145/3765612.3767255); [PubMed 42502812](https://pubmed.ncbi.nlm.nih.gov/42502812/)

**VLM plus a geometry head (strongest architecture evidence)**

- **Geometry-Enhanced Portion Estimation for Multimodal LLMs** [preprint; arXiv 2607.16514, Jul 2026]
  - Finding: MLLMs "recognize a wide range of foods zero-shot … but are weak at portion estimation." The missing quantity is "geometry, not recognition."
  - Design:
    - A frozen commercial MLLM supplies each food's name, bounding box and density range.
    - A small geometry network on a frozen DINOv2 backbone predicts portion.
  - Result: per-food portion error falls **33–41%** compared with the MLLM alone (Nutrition5k −41%, FPB −35%, NV-Real −33%). It beats every flagship MLLM's direct estimate and each dataset's original image-only model.
  - Sources: [arXiv abs](https://arxiv.org/abs/2607.16514); [HTML](https://arxiv.org/html/2607.16514)

**Consistency and other factors**

- **Run-to-run instability** [peer-reviewed; *JMIR Diabetes*; exact publication date not retrieved]
  - Setup: GPT-4o and GPT-5.1, 20 meal-image pairs showing the same physical meal from different viewpoints or arrangements, 60 repeated runs per image.
  - Variability comes from both visual presentation and inherent model instability.
  - GPT-5.1 varied more overall than GPT-4o.
  - GPT-4o was more sensitive to dish arrangement than to camera viewpoint.
  - Sources: [doi 10.2196/102715](https://doi.org/10.2196/102715); [PMC13544413](https://pmc.ncbi.nlm.nih.gov/articles/PMC13544413/)
- **What drives accuracy** [peer-reviewed; *Scientific Reports* 2026]
  - Model choice and image quality dominate. Multi-view imaging and prompt complexity had negligible effect.
  - High-quality consumer smartphone photos beat controlled lab imaging.
  - Professional nutritionists outperformed all VLMs by a 152% gap, especially on protein.
  - Authors' conclusion: VLMs suit consumer calorie tracking but not clinical-grade macro profiling.
  - Source: [Nature Sci Rep s41598-026-58755-w](https://www.nature.com/articles/s41598-026-58755-w)
- **Ingredient recognition across VLMs on Nutrition5k** [peer-reviewed; 2026]: average precision about 60%. Main food components are identified well, but quantifying nutrients for composite or visually ambiguous dishes remains hard. — [ScienceDirect S266592712600105X](https://www.sciencedirect.com/science/article/pii/S266592712600105X)
- **FoodNExTDB** [peer-reviewed; CVPR 2025 workshop]
  - Setup: 9,263 expert-labeled images; ChatGPT, Gemini, Claude, Moondream, DeepSeek and LLaVA tested.
  - Closed models exceed 90% expert-weighted recall on single-product images and beat open models.
  - All struggle with cooking styles and look-alike foods.
  - Source: [CVF open access PDF](https://openaccess.thecvf.com/content/CVPR2025W/MTF/papers/Romero-Tapiador_Are_Vision-Language_Models_Ready_for_Dietary_Assessment_Exploring_the_Next_CVPRW_2025_paper.pdf)
- **DietAI24** [peer-reviewed; *Communications Medicine* 2025]
  - An MLLM grounded with retrieval-augmented generation over the USDA FNDDS database (5,624 foods, 23,000+ portion sizes).
  - **63% lower MAE for food weight and four key nutrients** than existing methods on real-world mixed dishes (tested on ASA24 and Nutrition5k, against three commercial apps and a CV baseline).
  - Source: [Nature Comms Med](https://www.nature.com/articles/s43856-025-01159-0)
- **ACETADA** [peer-reviewed; IEEE 2025]: adding contextual metadata (venue type from GPS, meal type from timestamp) lowers LMM MAE and MAPE for calories, macros and portions. Ground truth came from a controlled-feeding trial with food weighed to 0.1 g. — [arXiv HTML](https://arxiv.org/html/2507.07048v1); [IEEE](https://ieeexplore.ieee.org/document/11269555/)

**Dedicated CV baseline** [older, 2021]

- **Nutrition5k (Google, CVPR 2021)** — [arXiv 2103.03375](https://arxiv.org/pdf/2103.03375)
  - RGB-only direct prediction: calorie MAE 70.6 kcal (26.1%).
  - Depth-derived volume scalar: mass error 18.7% → 13.7%.
  - Volume-assisted mass plus a portion-independent per-gram model: **end-to-end calorie MAE 16.5%**, macro MAE 26.2% (vs 31.9% RGB-only).
  - This is in-domain: fixed overhead RGB-D rig, same cafeterias in train and test.

**Specialized and fine-tuned models**

- **January AI's January Food Benchmark** [vendor-authored preprint]: the company's own food-vision-v1 scored 86.2 overall vs 74.1 for the best GPT-4o setup; Gemini 2.5 Pro and Flash reached 60.7. Conflict of interest applies. — [arXiv 2508.09966](https://arxiv.org/html/2508.09966v1)
- **Food-R1** [preprint, Jun 2026]: an open food VLM trained with chain-of-thought SFT plus GRPO reinforcement learning. On Nutrition5k it beats FoodLMM by 7.8 MAE and 7.7 pMAE points across calories, mass and macros. Releases a CalorieBench-80K dataset. — [arXiv 2606.04986](https://arxiv.org/abs/2606.04986)

**Informal benchmarks (not peer-reviewed; directional only)**

- **CalorieBench** (GitHub, updated 25 Sep 2026)
  - 200 Nutrition5k overhead photos, 31–942 kcal per plate.
  - MAE: Claude Fable 5.1 82 kcal, Claude Opus 5.5 91, Claude Sonnet 5 101, GPT-6 Luna 112, GPT-6 Sol 127, Claude Haiku 4.5 139, GPT-6 Astra 145.
  - The best model was within 20% on only 40% of plates.
  - Claude models underestimated meals over 500 kcal (Fable 5.1 by 209 kcal on average). GPT-6 models overestimated across the board (Astra +118 kcal).
  - Cost per 200-image run: $3.71–$11.66, i.e. about $0.02–$0.06 per image for frontier models.
  - Source: [github.com/mmiddlezong/calorie-bench](https://github.com/mmiddlezong/calorie-bench)
- **VLM-Nutrition-Benchmark** (GitHub, single author, 500 instances; not independently verifiable)
  - Calorie MAPE: Claude 3.5 Sonnet 12.6%, GPT-4o 13.5%, Gemini 1.5 Pro 16.5%, human dietitian 19.9%, LLaVA-1.6-34B 28.1%.
  - Claude's MAE rose **72% (44.7 → 77.0 kcal) on dishes with translucent oil or sauce drizzles**.
  - Source: [github.com/authrain-cloud-abdullahformuli/vlm-nutrition-benchmark](https://github.com/authrain-cloud-abdullahformuli/vlm-nutrition-benchmark)

### Inferences
- **Frontier VLMs on Nutrition5k-style plates land at about 80–145 kcal MAE.** That is no better than, and often worse than, the 2021 in-domain RGB-only CNN (70.6 kcal). It is clearly worse than the depth-assisted pipeline (16.5% MAPE). Test splits differ, so the comparison is directional.
- **Where VLMs win is out-of-domain generalization**, e.g. ordinary phone photos (the BCB '25 result), not raw accuracy.
- **Portion mass is the VLM's weak link.** About 36% weight MAPE, errors growing with portion size, and run-to-run drift together mean Macrofy should not use VLM-generated grams as its primary estimate. At most, use them as a fallback prior with an explicit uncertainty band.
- **The architecture the evidence supports:**
  - VLM (or classifier) for *what*.
  - Geometry, depth or reference-scale for *how much*.
  - Database lookup (RAG) for *per-gram macros*.
  - This matches the geometry-head paper, DietAI24 and Nutrition5k's portion-independent design.
- **Expected biases to correct:**
  - Underestimation that scales with portion size (negative slope).
  - Fat underestimation from hidden oils and sauces.
  - Instability across viewpoints and runs. Averaging over two or three frames or runs, or fixing temperature and seed, would reduce this.

### Gaps
- Per-model **weight** error in grams (MAE/MAPE) for the ten models, and the numbers for open Qwen2-VL-7B and FatSecret: the primary paper was not fetchable.
- Not reviewed: the *Nutrients* 2026 prompt-engineering multi-dataset study ([doi 10.3390/nu18122017](https://doi.org/10.3390/nu18122017)) and "A Confidence-Aware Hybrid Vision–Language Framework" ([doi 10.3390/nu18152449](https://doi.org/10.3390/nu18152449)). Both are likely relevant to prompt choice and to hybrid classifier-plus-VLM routing.
- No peer-reviewed study found that measures frontier-VLM gram error on **Brazilian or Latin American** mixed plates specifically.

---

## Q2. Small open VLMs that could run on-device or on a cheap server: sizes, memory, phone feasibility, licenses, food quality

### Takeaway
- Several permissively licensed VLMs in the 0.25–4B range now run on phones:
  - Gemma 4 E2B/E4B and Qwen3-VL-2B/4B (Apache 2.0).
  - SmolVLM2 (Apache 2.0).
  - MiniCPM-V 4.x (free commercial use after registration).
  - Gemma 3n E2B (about 2 GB memory).
- **No published evaluation of these small models on gram or macro estimation was found.** Available evidence says open and small models trail closed models on food recognition.
- They are plausible for on-device *food labeling* only, not grams.

### Cited Findings

**Qwen3-VL (Alibaba)** — [GitHub QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- Dense 2B, 4B, 8B, 32B; MoE 30B-A3B and 235B-A22B. Instruct and Thinking editions.
- Released Oct 2025 (4B/8B on 15 Oct, 2B/32B on 21 Oct). Apache-2.0; FP8 variants available.

**Qwen2.5-VL** (Jan 2025): 3B, 7B, 72B, with AWQ and INT8 quantized builds. — [Qwen blog](https://qwenlm.github.io/blog/qwen2.5-vl/); [RedHatAI w4a16](https://huggingface.co/RedHatAI/Qwen2.5-VL-3B-Instruct-quantized.w4a16)
- The 3B license was not verified in this session. The 72B and 3B checkpoints historically used non-Apache Qwen licenses (see Gaps).

**Gemma 4 (Google, 2 Apr 2026)** — [Wikipedia: Gemma](https://en.wikipedia.org/wiki/Gemma_(language_model)); [Datature](https://datature.io/blog/gemma-4-what-computer-vision-engineers-actually-need-to-know)
- **Apache 2.0**, dropping the earlier custom Gemma Terms of Use.
- Sizes: E2B (~2.3B effective), E4B (~4.5B effective), 26B-A4B MoE, 31B dense. All take text, image and video; E2B/E4B also take audio. 128K context on E2B/E4B.

**Gemma 3n** — [Google Developers Blog](https://developers.googleblog.com/en/introducing-gemma-3n-developer-guide/); [HF LiteRT build](https://huggingface.co/google/gemma-3n-E2B-it-litert-lm)
- E2B runs in as little as **~2 GB memory**.
- Vision encoder: MobileNet-V5-300M at 256/512/768 px, up to 60 fps on a Pixel.
- Ships in LiteRT format for phones.
- License is the older Gemma Terms (Gemma 4 later moved to Apache).

**SmolVLM2 (Hugging Face, 20 Feb 2025)** — [HF blog](https://huggingface.co/blog/smolvlm2); [SmolVLM-256M card](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct)
- 256M, 500M, 2.2B; Apache 2.0.
- The 500M model powers the free on-device iOS app HuggingSnap.
- 256M needs under 1 GB of GPU RAM; 2.2B about 5 GB per image query.

**MiniCPM-V 4.0 / 4.5 (OpenBMB)** — [GitHub OpenBMB/MiniCPM-V](https://github.com/openbmb/MiniCPM-V)
- iOS, Android and HarmonyOS deployment code is open-sourced.
- MiniCPM-V 4.0: under 2 s to first token and over 17 tokens/s on an iPhone 16 Pro Max.
- Code is Apache-2.0. Weights are free for commercial use after a registration questionnaire.

**Moondream 3 / 3.1** — [HF moondream3-preview](https://huggingface.co/moondream/moondream3-preview); [Moondream 3.1 card](https://moondream.ai/models/moondream_3-1_9B_A2B)
- 9B total parameters, 2B active (MoE, 64 experts, 8 active per token).
- **Business Source License 1.1** with a grant allowing most commercial use but excluding a competing hosted API. Using it inside an app is allowed; reselling it as an API is not.
- 9B total weights make it heavy for phones.
- Moondream 3.1 is served on Cloudflare Workers AI — [Cloudflare docs](https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/)

**Food-quality evidence for open and small models**
- FoodNExTDB (CVPR-W 2025): closed models (ChatGPT, Gemini, Claude) beat open ones (Moondream, DeepSeek, LLaVA) on food recognition. — [CVF PDF](https://openaccess.thecvf.com/content/CVPR2025W/MTF/papers/Romero-Tapiador_Are_Vision-Language_Models_Ready_for_Dietary_Assessment_Exploring_the_Next_CVPRW_2025_paper.pdf)
- Informal: LLaVA-1.6-34B had calorie MAPE 28.1% vs 13.5% for GPT-4o. — [GitHub](https://github.com/authrain-cloud-abdullahformuli/vlm-nutrition-benchmark)
- Qwen2-VL-7B was included in the peer-reviewed 10-model benchmark, but its numbers were not retrievable. — [PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/)
- Food-R1 shows food-specific RL fine-tuning of an open VLM beats the prior food VLM (FoodLMM) on Nutrition5k. — [arXiv 2606.04986](https://arxiv.org/abs/2606.04986)

### Inferences
- **Best on-device candidates for Macrofy** (mobile tooling plus permissive license): Gemma 4 E2B/E4B and Qwen3-VL-2B/4B (Apache 2.0).
- **SmolVLM2-500M/2.2B** is the lowest-memory fallback.
- **MiniCPM-V** is attractive on iOS but needs license registration.
- **Moondream's BSL** is fine for in-app use but the model is heavy.
- **Expect small models to be materially worse than Gemini Flash-class models on dish identification**, especially regional dishes. Plan to fine-tune (LoRA) on a Macrofy food-label set, or use a small model only as a first-pass tagger with cloud fallback.
- **None of these should be asked for grams.** Use them to emit food labels, boxes or masks, and "hidden ingredient" flags.

### Gaps
- No benchmark found of Qwen3-VL-2B/4B, Gemma 3n/4 E2B/E4B, SmolVLM2, PaliGemma 2, Florence-2 or InternVL3.x on food recognition or nutrition (Food-101, Nutrition5k, etc.).
- No measured on-phone latency or memory found for food-specific prompts.
- PaliGemma 2, Florence-2, InternVL and Qwen2.5-VL-3B licenses were not verified in this session (Hugging Face was blocked). Verify before shipping.

---

## Q3. Cheapest hosted options, free tiers, and self-hosting cost per 1,000 images

### Takeaway
- **Cheapest reliable hosted VLM today:** Gemini Flash-Lite.
  - 3.1 Flash-Lite lists at $0.25/M input and $1.50/M output tokens, with a free tier.
  - That works out to roughly **$0.6–0.9 per 1,000 meal photos** with terse JSON output. The peer-reviewed benchmark measured $0.59/1K.
  - Gemini 2.5 Flash-Lite is cheaper again (about $0.3/1K), if it is still offered.
- **The old $0.10/1K option (Gemini 2.0 Flash) was shut down on 1 Jun 2026.**
- **Output tokens, not image tokens, dominate cost.** The free tier allows training on user data and has low, unpublished quotas.
- **On-device inference has zero marginal cost.**

### Cited Findings

**Gemini 3.1 Flash-Lite**
- Official price: $0.25 per 1M input tokens (text, image, video), $1.50 per 1M output. The free tier is free of charge. — [ai.google.dev pricing](https://ai.google.dev/gemini-api/docs/pricing)
- A third-party tracker lists **$0.125 / $0.75**, which is likely the 50% batch or discounted rate. — [pricepertoken](https://pricepertoken.com/pricing-page/model/google-gemini-3.1-flash-lite)
- Model page: [ai.google.dev model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)

**Gemini 3.5 Flash-Lite**
- Third-party sources list **$0.30 / $2.50 per 1M**. Not confirmed on Google's page, and suspiciously equal to 2.5 Flash pricing. — [eesel](https://www.eesel.ai/blog/gemini-3-5-flash-lite-pricing); [aipricing.org](https://aipricing.org/models/gemini-3-5-flash-lite)
- Google's docs also show a newer "Gemini 3.8 Flash" model. — [ai.google.dev latest model](https://ai.google.dev/gemini-api/docs/latest-model)

**Gemini 2.5 Flash-Lite**: **$0.10 / $0.40 per 1M**, same rate for image and text input. — [devtk.ai](https://devtk.ai/en/models/gemini-2-5-flash-lite/); [OpenRouter](https://openrouter.ai/google/gemini-2.5-flash-lite)

**Gemini 2.0 Flash / Flash-Lite**: end-of-life **1 Jun 2026**, hard shutdown; Google pointed users to 2.5 Flash and Flash-Lite. — [Google AI Developers Forum](https://discuss.ai.google.dev/t/gemini-2-0-flash-discontinuation-date/131389); [TheRouter](https://therouter.ai/news/gemini-2-flash-deprecation-june-2026-migration/)

**How images are counted as tokens**
- Gemini 3 `media_resolution`: low = 280, medium = 560, high = 1,120 tokens per image. — [Gemini 3 dev guide](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3); [media resolution docs](https://ai.google.dev/gemini-api/docs/media-resolution)
- Gemini 2.x: an image with both sides ≤384 px = 258 tokens; larger images are tiled into 768×768 tiles at 258 tokens each. — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)

**Free tier and data use**
- Quota: third-party guides report about 500 requests/day for 3.1 and 3.5 Flash-Lite. Google no longer publishes fixed per-day numbers and changes them without notice. — [pecollective](https://pecollective.com/tools/gemini-free-tier-guide/); [aipromptshub](https://aipromptshub.co/limits/gemini-rate-limits-2026)
- Data: free-tier content may be used to improve Google's products and may be human-reviewed; paid-tier content is not. — [Gemini API billing docs](https://ai.google.dev/gemini-api/docs/billing); [ampm-aiops guide](https://ampm-aiops.com/en/guides/gemini-free-tier-data-tradeoff-2026/)
- Enabling billing immediately moves an account to Tier 1 with 100–200× higher limits. — [pecollective](https://pecollective.com/tools/gemini-free-tier-guide/)

**Measured cost per 1K images** (peer-reviewed benchmark): Gemini 3.1 Flash-Lite $0.59; Gemini 2.0 Flash $0.10. — [PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/)

**Frontier models, for contrast** (informal): about $0.02–$0.06 per image, or $18–58 per 1K. — [CalorieBench](https://github.com/mmiddlezong/calorie-bench)

**Self-hosting reference point:** serving an 8B text model with vLLM on one A100 costs about **$0.13–$0.34 per 1M tokens** at good utilization. — [premai.io](https://www.premai.io/blog/self-hosted-llm-guide-setup-tools-cost-comparison-2026/)

### Inferences

These are my calculations, not measured values.

**Hosted, per image (Gemini 3.1 Flash-Lite at list price)**
- Input: 280 image tokens (low) + about 250 prompt tokens ≈ 530 tokens ≈ $0.00013.
- Output: about 400 tokens of JSON ≈ $0.0006.
- Total ≈ **$0.73 per 1K images**. At high resolution (1,120 tokens) it is about $0.94 per 1K.
- **Keep output terse** (e.g. only labels, DB IDs and flags; let the app compute macros) and **turn off or minimize "thinking" tokens**, which bill as output. Together these could roughly halve the cost.

**Hosted, per image (Gemini 2.5 Flash-Lite)**
- Input ≈ 1,300 tokens × $0.10/M + output 400 × $0.40/M ≈ **$0.30 per 1K images**, if it is still available.

**Example volume:** 1,000 daily users × 3 photos a day ≈ 90K photos/month ≈ **$27 (2.5 Flash-Lite) to $66 (3.1 Flash-Lite) per month**. At 10× that scale, about $270–660/month.

**Free tier:** usable for prototyping and evaluation. It is unsuitable for production user photos, for two reasons: product-improvement training on user data and privacy disclosure, and roughly 500 requests/day.

**Self-hosting a 7–8B VLM**
- At about 1.3K tokens per image and $0.13–$0.34 per 1M tokens, the compute is about **$0.17–$0.44 per 1K images**, but only at high utilization.
- At low volume, idle GPU time dominates, making it far more expensive than Flash-Lite.
- Self-hosting only pays off at very high volume or for privacy.

**On-device:** a small VLM on the phone costs $0 per image. The trade-offs are app size (hundreds of MB to ~2 GB), battery and latency, and lower recognition quality.

### Gaps
- Could not open Google's pricing page directly:
  - The official Gemini 3.5 Flash-Lite price is unconfirmed.
  - Whether 2.5 Flash-Lite has a shutdown date is unverified.
  - Batch-API discount details are unverified.
- Not verified in this session: whether Gemini API free-tier terms restrict serving end users in the EEA, UK or Switzerland.
- No measured images-per-hour or cost-per-1K-images figures found for self-hosted Qwen2.5-VL, Qwen3-VL or Gemma on an L4 or T4 class GPU.
- Cloudflare Workers AI pricing for Moondream 3.1, and other low-cost hosted open VLMs (Together, Groq, DeepInfra), were not retrieved.

---

## Q4. Where a VLM adds value without dominating cost, and where it should not be trusted

### Takeaway
**Use a VLM (on-device first, cheap cloud as fallback) for:**
- open-vocabulary dish and ingredient identification, including regional and mixed dishes;
- flagging likely hidden fats and sauces;
- mapping labels to database entries;
- optional voice or text context.

**Do not trust it for grams.** Evidence shows about 36% weight MAPE, growing underestimation on larger portions, fat underestimation, and run-to-run variance. Geometry, depth, a reference object or user confirmation should own grams.

### Cited Findings
- **Recognition strength:**
  - Gemini 3.1 Flash-Lite had the highest ingredient recognition among 10 models (Jaccard 0.655); corrected-label estimates reach about 0.82. — [PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/)
  - Closed VLMs exceed 90% expert-weighted recall on single products. — [CVF PDF](https://openaccess.thecvf.com/content/CVPR2025W/MTF/papers/Romero-Tapiador_Are_Vision-Language_Models_Ready_for_Dietary_Assessment_Exploring_the_Next_CVPRW_2025_paper.pdf)
- **Portion weakness:**
  - About 36–37% weight MAPE, with underestimation that grows with portion size (slopes −0.23 to −0.50). — [PMC12513282](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/)
  - "Weak at portion estimation … the missing quantity is geometry." — [arXiv 2607.16514](https://arxiv.org/abs/2607.16514)
- **Hybrid wins:**
  - A frozen MLLM supplying names, boxes and density ranges, plus a geometry head, cuts portion error 33–41%. — [arXiv 2607.16514](https://arxiv.org/abs/2607.16514)
  - Supplying predicted weight cut Gemini 2.5 Flash carbohydrate MAPE from 56.6% to 39.5%. — [ACM BCB'25](https://doi.org/10.1145/3765612.3767255)
- **Database grounding:** MLLM + RAG over FNDDS gave 63% lower MAE for weight and key nutrients on mixed dishes. — [Communications Medicine](https://www.nature.com/articles/s43856-025-01159-0)
- **Context helps:**
  - Adding descriptors, then ingredient lists with amounts, stepwise improves ChatGPT-5 kcal and macro MAE. — [Nutrients 2025](https://doi.org/10.3390/nu17223613)
  - Location and time metadata reduce LMM MAE. — [ACETADA arXiv](https://arxiv.org/html/2507.07048v1)
- **Hidden fat is the systematic miss:**
  - In the NIH controlled-meal test, all four commercial apps underestimated fat by about 30 g per meal. — [ScienceDaily](https://www.sciencedaily.com/releases/2026/07/260726015237.htm)
  - Informal benchmark: +72% MAE on oil or sauce drizzles. — [GitHub](https://github.com/authrain-cloud-abdullahformuli/vlm-nutrition-benchmark)
- **Regional dishes are a known weak spot:**
  - AI image-recognition apps identified components well, but energy estimates for mixed and cultural dishes were poor.
  - Manual-logging apps over-estimated Western diets (+1,040 kJ) and under-estimated Asian diets (−1,520 kJ).
  - Source: [Nutrients 2024, 16(15):2573](https://www.mdpi.com/2072-6643/16/15/2573)
- **Instability:** GPT-4o and GPT-5.1 estimates vary with viewpoint or arrangement and across repeated runs. — [JMIR Diabetes](https://doi.org/10.2196/102715)

### Inferences
- **Does Macrofy need a VLM?** Not for its core value (lowest-error grams). An LLM or VLM is optional and useful mainly as the *recognition and context* layer.
- **A no-paid-LLM design is viable:**
  - An on-device food segmenter or classifier, or a small Apache-2.0 VLM (Gemma 4 E2B, Qwen3-VL-2B), handles recognition.
  - Depth or reference-scale geometry handles volume.
  - Density and nutrition tables handle grams and macros.
  - The user confirms low-confidence items.
- **If recognition quality on mixed or regional dishes falls short**, add a **confidence-gated** call to Gemini Flash-Lite. Call it only on low-confidence photos, ask for labels, DB IDs and hidden-fat flags only, keep output short and thinking off. Expected cost is well under $1 per 1K *gated* images.
- **Never let the VLM's gram numbers override geometry.** If they are used as a prior, apply a portion-size-dependent bias correction (VLMs under-call large portions).
- **For hidden fats:** a VLM prompt such as "is this pan-fried / sauced / dressed?" can trigger a fat adder or a one-tap user question. This targets the roughly 30 g fat gap seen in commercial apps.
- **Use temperature 0 and a structured-output schema.** Optionally take the median over two or three frames to damp the instability the JMIR study measured.

### Gaps
- No controlled study found that isolates the benefit of VLM "hidden ingredient" prompting on fat-estimation error.
- No evidence found on how well small on-device VLMs map to national food composition databases (e.g. Brazil's TACO/TBCA). Those databases were not researched here.

---

## Q5. Commercial apps: technology, claimed accuracy, independent validation

### Takeaway
- **Most of the market leaders use a cloud VLM or classifier plus a database, not depth.** Cal AI uses OpenAI and Anthropic models with RAG; MyFitnessPal Meal Scan uses Passio; Lose It! Snap It uses its own neural network.
- **SnapCalorie is the notable exception:** LiDAR volume, founded by the Nutrition5k/Google Lens team.
- **Claimed accuracy is about 85–90%**, but the only controlled independent test (NIH, 2026 abstract) found all four apps tested **underestimating calories by 252–345 kcal per meal (about 33%) and fat by about 30 g**.
- **No independent validation of SnapCalorie's roughly 16% claim was found.**

### Cited Findings

**NIH/NIDDK controlled test (2026)** [abstract, presented at NUTRITION 2026, not yet peer-reviewed]
- Setup: 102 metabolic-kitchen meals with every ingredient weighed, from a larger NIH Clinical Center ketogenic vs standard diet study. Lead: Aaron Hengist; presented by Olivia Charles.
- Average calorie underestimation per meal:
  - Appediet: −252 kcal
  - MyFitnessPal: −327 kcal
  - Lose It!: −333 kcal
  - Cal AI: −345 kcal
- About 33% underestimation on average across apps.
- Fat underestimated by about 30 g in all four apps. Lose It! and Cal AI also under-called carbohydrates by about 14 g.
- Lose It! and MyFitnessPal were more accurate on higher-energy meals than lower-energy ones.
- Sources: [ScienceDaily](https://www.sciencedaily.com/releases/2026/07/260726015237.htm); [Healio](https://www.healio.com/news/primary-care/20260804/ai-photobased-calorietracking-tools-underestimate-them-by-33); [Medscape](https://www.medscape.com/viewarticle/photo-based-meal-apps-underestimate-calories-and-fat-2026a1000qo9); [EurekAlert](https://www.eurekalert.org/news-releases/1136415)

**Cal AI**
- Built by teenagers Zach Yadegari and Henry Langmack, launched May 2024.
- Technology: "uses models from Anthropic and OpenAI and RAG," trained on open-source food calorie and image datasets. Creators claim **90% accuracy**. — [TechCrunch, 16 Mar 2025](https://techcrunch.com/2025/03/16/photo-calorie-app-cal-ai-downloaded-over-a-million-times-was-built-by-two-teenagers/)
- A third-party teardown says Cal AI combines the phone depth sensor with its model. That is unverified, and Cal AI has published no architecture. — [RaftLabs teardown](https://www.raftlabs.com/blog/cal-ai-product-teardown)
- **Acquired by MyFitnessPal:** closed Dec 2025, announced 2 Mar 2026. At that point it had 15M+ downloads, over $30M annual revenue and a 7-person team, and it remains a standalone app. — [TechCrunch 2 Mar 2026](https://techcrunch.com/2026/03/02/myfitnesspal-has-acquired-cal-ai-the-viral-calorie-app-built-by-teens/); [GlobeNewswire](https://www.globenewswire.com/news-release/2026/03/02/3247439/0/en/MyFitnessPal-Acquires-Cal-AI-Expanding-on-its-Position-as-the-Leading-Player-in-Digital-Nutrition-Tracking.html)
- Independent result: −345 kcal per meal in the NIH test (above).

**MyFitnessPal Meal Scan**
- Powered by Passio's food-recognition SDK combined with MyFitnessPal's 14M-item food database. Premium-only. — [Passio case study](https://www.passio.ai/case-studies/myfitnesspal); [MFP Meal Scan FAQ](https://support.myfitnesspal.com/hc/en-us/articles/360045761612-Meal-Scan-FAQ)
- MFP also integrated with ChatGPT Health in Jan 2026 and acquired the meal-planning app Intent in 2025. — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/03/02/3247439/0/en/MyFitnessPal-Acquires-Cal-AI-Expanding-on-its-Position-as-the-Leading-Player-in-Digital-Nutrition-Tracking.html)
- Independent validation:
  - University of Sydney (*Nutrients* 2024): among seven AI image-recognition apps, MyFitnessPal (97%) and Fastic (92%) had the highest food *identification* accuracy. Energy estimation for mixed and cultural dishes was poor. — [MDPI Nutrients 16(15):2573](https://www.mdpi.com/2072-6643/16/15/2573)
  - NIH 2026: −327 kcal per meal.
- An informal review site reports 71.2% identification on 500 images, falling to 58.3% on East Asian food; methodology unknown. — [ai-food-tracker.com](https://ai-food-tracker.com/reviews/myfitnesspal/) [informal]

**Lose It! Snap It**
- Launched Sep 2016 as a neural-network food recognizer. The user confirms the food and **picks the portion size**. — [TechCrunch 2016](https://techcrunch.com/2016/09/29/lose-it-launches-snap-it-to-let-users-count-calories-in-food-photos/) [older]; [Lose It! support](https://loseit.zendesk.com/hc/en-us/articles/47771695186580-How-to-Use-Snap-It)
- Independent result: −333 kcal per meal in the NIH test.
- An informal site claims 68.7% identification and ±22% portion MAPE; unverified. — [ai-food-tracker.com](https://ai-food-tracker.com/reviews/lose-it/) [informal]

**SnapCalorie**
- Founded by ex-Google AI researchers; co-founder Wade Norris co-founded Google Lens. The company cites the Nutrition5k study (5,000 weighed dishes) as its research base. Raised $3M in 2023. — [TechCrunch 2023](https://techcrunch.com/2023/06/26/snapcalorie-computer-vision-health-app-raises-3m/) [older]; [SnapCalorie FAQ](https://www.snapcalorie.com/faq.html)
- Uses **LiDAR depth on iPhone Pro** for volume. — [App Store](https://apps.apple.com/us/app/snapcalorie-ai-calorie-counter/id1574239307)
- Claimed accuracy [vendor claim]:
  - ±80 kcal on a 500 kcal dish with iPhone Pro (LiDAR), ±130 kcal on a regular iPhone, vs ±265 kcal for users eyeballing portions.
  - "Twice the accuracy of a professional nutritionist."
  - About 15–16% average error.
  - Sources: [App Store listing](https://apps.apple.com/us/app/snapcalorie-nutrition-tracker/id1574239307); [snapnutrition.app accuracy page](https://snapnutrition.app/accuracy) [competitor/aggregator]
- These claims match Nutrition5k's depth-pipeline 16.5% calorie MAE. — [arXiv 2103.03375](https://arxiv.org/pdf/2103.03375)
- **No independent validation found.**

**Foodvisor**
- JMIR mHealth 2020: top-1 identification 46%, top-5 72%; about 71% of mixed-dish components appeared in its top-5. **None of the platforms tested could estimate portion size.** — [PMC7752530](https://pmc.ncbi.nlm.nih.gov/articles/PMC7752530/) [older]
- The 2024 Sydney study reported high identification (search extract gives 87%) but large energy discrepancies on mixed dishes. — [MDPI Nutrients 2024](https://www.mdpi.com/2072-6643/16/15/2573)

**Calorie Mama (Azumio)**: a deep-learning Food AI API marketed as the "most culturally diverse" food ID system. **No accuracy figures or independent validation found.** — [caloriemama.ai](https://www.caloriemama.ai/); [Azumio](https://www.azumio.com/apps/calorie-mama/overview)

**Bitesnap**: an early deep-learning food logger (Show HN 2017), still listed on the web. The founder commented on HN in Jan 2025. No accuracy data or current tech details found. — [getbitesnap.com](https://getbitesnap.com/); [HN 2025](https://news.ycombinator.com/item?id=42780689) [older]

**January AI** [vendor-authored]: sells a food-vision API (food-vision-v1) and white-label B2B service, and scored itself 86.2 vs 74.1 for GPT-4o on its own benchmark. — [january.ai/apis](https://january.ai/apis); [arXiv 2508.09966](https://arxiv.org/html/2508.09966v1)

**FatSecret**: offers a commercial food-recognition API, evaluated in the 10-model benchmark; its numbers were not retrieved. — [PMC13483877](https://pmc.ncbi.nlm.nih.gov/articles/PMC13483877/)

**2025–26 entrants and marketing**
- Nutrola markets "depth-aware" photo tracking using TrueDepth, LiDAR and monocular depth. It cites academic consumer-LiDAR results of 8–12% MAE for single foods and 14–18% for composites. [vendor claim; unverified] — [Nutrola blog](https://nutrola.app/en/blog/depth-aware-ai-vision-iphone-lidar-to-calorie-counts)
- A Springer chapter on smartphone-LiDAR calorie estimation exists; numbers not retrieved. — [Springer](https://link.springer.com/chapter/10.1007/978-981-95-4398-4_10)
- Many "ChatGPT/Claude wrapper" calorie apps exist, e.g. 7-CAL, advertised as powered by GPT, Gemini and Claude. — [7-cal.com](https://www.7-cal.com/)

### Inferences
- **Realistic accuracy benchmarks for Macrofy:**
  - Popular photo apps (MFP, Lose It!, Cal AI): about 33% calorie underestimation per meal and about 30 g fat under-call in a controlled test. This is a low bar that Macrofy should beat.
  - Frontier VLMs zero-shot on plated meals: about 80–145 kcal MAE, and about 36% weight MAPE on standardized photos.
  - Depth-assisted dedicated pipelines: about 16% calorie MAPE, both in Nutrition5k and in SnapCalorie's own claim.
  - So **~15–20% calorie MAPE is state of the art with depth**, and **~25–35% without depth**.
- **The market leaders' error is dominated by a *negative bias***: under-counted portions and fat. A calibrated bias correction alone could remove much of it. The bias is measurable on a small in-house weighed-meal set.
- **Cal AI's success came from low-friction UX and cloud frontier models, not accuracy.** A no-paid-API competitor has to win on geometry (depth, reference scale) and on handling hidden fat.

### Gaps
- The NIH study's full data (per-app MAPE, protein results, how many items the apps misidentified vs mis-sized) is not published yet; only an abstract and press coverage exist.
- No independent peer-reviewed validation found for SnapCalorie, Foodvisor (portion accuracy), Calorie Mama, Bitesnap or Nutrola.
- Current (2026) back-ends were not confirmed:
  - whether MFP Meal Scan still uses Passio after the Cal AI acquisition;
  - whether Lose It! Snap It now uses an LLM;
  - whether Cal AI uses depth.
- Other 2026 entrants (e.g. features in MacroFactor, Apple or Google health apps) were not researched in depth.

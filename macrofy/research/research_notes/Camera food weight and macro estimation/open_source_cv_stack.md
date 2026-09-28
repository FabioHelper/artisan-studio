# Open-source computer-vision stack for a zero-API-cost, on-device food analyzer (as of late Sep 2026)

Scope: models and runtimes for camera image → per-item masks + labels → depth/volume → grams → macros, on a phone (or a cheap self-hosted server as fallback), with no paid LLM APIs and preferably no LLM. Research date: 2026-09-28.

Method note: arXiv, Hugging Face, Meta AI blog, Apple ML Research and most vendor-doc domains were **blocked by this environment's egress proxy**. Facts below come mainly from primary GitHub READMEs/LICENSE files and source code (fetched raw), Apple's Core ML model gallery, Qualcomm AI Hub's published per-device benchmark files, and web-search excerpts. Items that come only from a search-engine excerpt, which I could not open, are marked **(search excerpt)**. Treat those as lower confidence.

---

## 1. Food recognition / classification (Food-101, Food2K, UEC-Food256, Brazilian coverage, CLIP/SigLIP/DINO backbones)

### Takeaway
No off-the-shelf open model covers Brazilian dishes well, and the main food benchmarks (Food-101, UEC-Food256) come with non-commercial or "fair-use only" data terms. The practical path is a small, commercially licensed embedding backbone: SigLIP 2 (Apache-2.0 code, CC-BY-4.0 weights), DINOv2/DINOv3 (Meta licenses that permit commercial use), or CLIP ViT-B/16. On top of it, train a linear probe or k-NN on a custom Brazilian dataset (rice, beans, farofa, etc.), and optionally use text-prompt zero-shot for the long tail. MobileCLIP/MobileCLIP2 are the fastest on iPhone, but their weights are **research-only**.

### Cited Findings
**Benchmarks and SOTA numbers**
- Food2K has 1,036,564 images in 2,000 categories and is an order of magnitude larger than ETH Food-101 in both categories and images — [Large Scale Visual Food Recognition (Min et al.)](https://arxiv.org/pdf/2103.16107) (search excerpt)
- Food2K top-1: NoisyViT reports **95%** — [Improving Food Image Recognition with Noisy Vision Transformer, arXiv 2503.18997](https://arxiv.org/abs/2503.18997) (search excerpt). Other 2025 papers report **86.22%** (ensemble→distillation, 131.56M params) — [ScienceDirect 2025](https://www.sciencedirect.com/science/article/abs/pii/S0952197625007274) — and **85.87%** (coarse-to-fine + boundary-aware) — [PMC11817195](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11817195/) (both search excerpts). The 86% vs 95% gap likely reflects different splits or protocols, so it is not a like-for-like SOTA.
- On a balanced Food-101 setup, embedding-based classification gave DINOv2 **93%**, CLIP **88%** and ResNet-18 **65%** — [Voxel51, "Finding the Best Embedding Model for Image Classification"](https://voxel51.com/blog/finding-the-best-embedding-model-for-image-classification) (search excerpt; I could not read the exact subset or classifier).
- DINOv2 linear probe on the "Food" transfer benchmark: **94.3%** (the excerpt attributes this to ViT-B/14; model size unverified) — [DINOv2 paper](https://arxiv.org/pdf/2304.07193) (search excerpt)
- CLIP zero-shot on Food-101 is **>90% top-1**, more than 15 points above a ResNet-50 classifier — [Labellerr analysis of CLIP on food](https://www.labellerr.com/blog/performance-of-clip-over-food-classification-dataset-here-are-the-findings/) (search excerpt). A search result also quoted CLIP at 91.55% and SigLIP at 88.81% zero-shot on Food-101 in one recent study, but I could not confirm which paper those numbers came from.
- Real-world food logs differ from web-crawled benchmark images. FoodLogAthl-218 (ACM MM 2025) has 6,925 real app-log images, 218 categories and 14,349 boxes, and was built because web-crawled datasets differ from users' real meal photos — [arXiv 2512.14574](https://arxiv.org/abs/2512.14574) (search excerpt)

**Backbones usable for zero-shot, linear-probe or fine-tuning (license + size)**
- **SigLIP 2** (Google, Feb 2025). All code is Apache-2.0 and "all other materials" (the checkpoints) are CC-BY 4.0. ImageNet zero-shot: B/16@224 **78.2%**, B/16@384 **80.6%**, L/16@384 **83.1%**, So400m/14@384 **84.1%**, g-opt/16@384 **85.0%**. There are also NaFlex (variable-aspect) B/16 and So400m variants — [big_vision SigLIP 2 README](https://github.com/google-research/big_vision/blob/main/big_vision/configs/proj/image_text/README_siglip2.md)
- A SigLIP ViT-B/16 Core ML port exists in a community model zoo — [john-rocky/CoreML-Models](https://github.com/john-rocky/CoreML-Models)
- **MobileCLIP2** (Apple, Aug 2025; TMLR Featured). MobileCLIP2-S0: 11.4M image + 63.4M text params, **1.5 ms + 3.3 ms** latency, 71.5% ImageNet zero-shot. S2: 35.7M+63.4M, 3.6+3.3 ms, 77.2%. B: 86.3M+63.4M, 10.4+3.3 ms, 79.4%. S4: 321.6M+123.6M, 19.6+6.6 ms, 81.9%. The README says latency comparisons are measured on iPhone 12 Pro Max — [apple/ml-mobileclip](https://github.com/apple/ml-mobileclip)
- **License flag:** MobileCLIP code is MIT, but the ML models fall under the "Apple ML Research Model TOU", which grants use "exclusively for Research Purposes". That explicitly excludes "commercial exploitation, product development or use in any commercial product or service". The data is CC-BY-NC-ND — [ml-mobileclip README License section](https://github.com/apple/ml-mobileclip) and [LICENSE_MODELS](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)
- **DINOv3** code and weights use the "DINOv3 License": a non-exclusive, worldwide, royalty-free grant to use, reproduce, distribute and create derivative works, with trade-control/ITAR/military use restrictions — [facebookresearch/dinov3 LICENSE.md](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)
- **OpenAI CLIP ViT-B/16** runs on Snapdragon NPUs: **17.0 ms** (TFLite FP32) on Galaxy S25 and **21.1 ms** on Galaxy S24; W8A16 is 14.9 ms on S25 (ONNX) — [Qualcomm AI Hub openai_clip perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/openai_clip/perf.yaml) (default weights "ViT-B/16", 224 px per [model.py](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/openai_clip/model.py))
- **RAM++ (Recognize Anything Plus)**, Apache-2.0, is an open-set image tagger that the authors say recognizes both predefined and open-set categories and outperforms CLIP/BLIP on zero-shot tagging — [xinyu1205/recognize-anything](https://github.com/xinyu1205/recognize-anything). Useful as a no-LLM "what's on the plate" tagger. No food-specific numbers were found.

**Brazilian / Latin food coverage**
- **MyFood** (Brazil, 2020) covers the most-consumed Brazilian foods: **9 classes, 1,250 images**, with rice and beans among the classes. It compared FCN, ENet, SegNet, DeepLabV3+ and Mask R-CNN; FCN and Mask R-CNN were best at **IoU ≈ 0.70**. It is designed for a mobile nutrient-estimation app — [MyFood, arXiv 2012.03087](https://arxiv.org/abs/2012.03087) (search excerpt)
- Brazilian academic work has built datasets around the "Cesta Básica" meal (grilled meat, white rice, carioca beans, lettuce). Dedicated public Brazilian food image datasets appear limited — [search results incl. UNIFEI thesis](https://repositorio.unifei.edu.br/jspui/bitstream/123456789/4112/1/Tese_2024039.pdf) (search excerpt)
- MyFoodRepo-273 (Swiss app data) has 24,119 images, 39,325 segmented polygons and 273 classes — [Food Recognition Benchmark, Frontiers in Nutrition 2022](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2022.875143/full) (search excerpt)

### Inferences
- For a Brazilian-first product, the classifier's ceiling depends on a custom labeled set (arroz branco, feijão carioca/preto, farofa, frango grelhado, bife, salada, ovo, batata frita, macarrão, etc.), not on public benchmarks. A frozen SigLIP 2 B/16 or DINOv2/v3 ViT-S/B embedding with a linear or k-NN head is cheap to train (minutes on a CPU/GPU) and easy to update. Adding classes needs no retraining of the backbone.
- Zero-shot text prompts (SigLIP 2 / CLIP) are a reasonable long-tail fallback without an LLM. Expect lower accuracy on visually similar items (farofa vs. couscous vs. breadcrumbs, feijão preto vs. feijoada) than on Food-101.
- If commercial use is planned, avoid MobileCLIP/MobileCLIP2 weights (research-only) despite their best-in-class iPhone latency. Use CLIP ViT-B/16 (MIT) or SigLIP 2 (CC-BY) instead.

### Gaps
- I could not open the DINOv2, SigLIP 2 or CLIP papers to get verified per-model Food-101 linear-probe/zero-shot tables, or any SigLIP 2 Food-101 number.
- I found no published accuracy for any open model on Brazilian dishes such as farofa, feijoada or pão de queijo, and no large public Brazilian food dataset with a commercial-friendly license.
- UEC-Food256 SOTA classification numbers were not retrieved.

---

## 2. Segmentation: SAM family, efficient SAMs, food-specific SOTA, open-vocabulary detectors/segmenters

### Takeaway
For "masks + labels per food item" on a phone, the most practical open stack is:
- **(a)** a fast instance segmenter fine-tuned on your own food classes: RF-DETR-Seg (Apache-2.0), or YOLO26-seg/YOLOE (AGPL-3.0);
- **or (b)** an open-vocabulary segmenter (YOLOE text/prompt-free) plus a promptable refiner such as SAM 2.1-tiny (Apache-2.0) or EfficientViT-SAM (Apache-2.0).

SAM 3 (Nov 2025, 848M params) is state of the art for text-prompted "segment every instance of X". It is commercially usable under Meta's SAM License, but it takes **~1.3–1.6 s** for just the vision backbone on a Galaxy S24/S25 NPU. That makes it a server or distillation-teacher model, not a phone model. EdgeSAM is the fastest SAM on iPhone but is **non-commercial**. Food-specific semantic segmentation tops out around **~55 mIoU on FoodSeg103** and **~76 mIoU on UEC-FoodPix Complete**.

### Cited Findings
**SAM 3 / 3.1 (Meta)**
- SAM 3 was released **2025-11-19**. It is a detector plus a tracker sharing one vision encoder, with **848M parameters**. It does "Promptable Concept Segmentation" (text phrase or exemplar → all instances) and reaches 75–80% of human performance on the SA-Co benchmark (270K concepts) — [facebookresearch/sam3 README](https://github.com/facebookresearch/sam3). Release date: [SAM 3 LICENSE "Last Updated: November 19, 2025"](https://github.com/facebookresearch/sam3/blob/main/LICENSE) and [Roboflow](https://blog.roboflow.com/what-is-sam3/)
- SAM 3 image results from the README. Instance segmentation: LVIS cgF1 **37.2**, LVIS AP **48.5**, SA-Co/Gold cgF1 **54.1** (human 72.8). Box detection: LVIS AP **53.6**, COCO AP **56.4**. For comparison, OWLv2 scores LVIS mask AP 43.4 and SA-Co/Gold cgF1 24.6 — [sam3 README](https://github.com/facebookresearch/sam3)
- SAM 3 runs at about **30 ms/image on an H200** with 100+ objects — [Roboflow blog](https://blog.roboflow.com/what-is-sam3/) (search excerpt)
- **SAM 3.1** ("Object Multiplex") was released **2026-03-27**, with new checkpoints and **~7× speedup at 128 objects on one H100** for video multi-object tracking — [RELEASE_SAM3p1.md](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)
- On phone NPUs (Qualcomm AI Hub, input 1008×1008), the SAM 3 vision backbone takes **1,290–1,294 ms on Galaxy S25** and **1,617–1,648 ms on S24**, and the head **267–272 ms (S25)** / 356–360 ms (S24) — [QAI Hub sam3 perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam3/perf.yaml), [model.py](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam3/model.py)
- **EfficientSAM3** (community, Apache-2.0) distills SAM 3 into RepViT, TinyViT or EfficientViT image encoders plus MobileCLIP-based text encoders. Stage-3 models EV-M, RV-M and TV-M have 89.2M, 92.7M and 95.3M total params (≈90% smaller) and were released 2026-06-11. ONNX/TensorRT export exists; **Core ML export is "still pending"**; no mobile latency is published — [SimonZeng7108/efficientsam3](https://github.com/SimonZeng7108/efficientsam3). Note: its text encoders are MobileCLIP-derived, so check whether Apple's research-only model terms carry over.

**SAM 2 / 2.1 and efficient SAM variants**
- SAM 2.1 checkpoints (2024-09-29): tiny **38.9M** (91.2 FPS on GPU), small 46M (84.8), base+ 80.8M (64.1), large 224.4M (39.5). **Apache-2.0** — [facebookresearch/sam2](https://github.com/facebookresearch/sam2)
- SAM 2 (tiny, the QAI Hub default) on phone NPUs: the encoder takes **119–125 ms** FP32 on S24 and 103.7 ms on S25; W8A8 is **38–52 ms on S25** and 51–56 ms on S24; the decoder takes **1–4 ms** — [QAI Hub sam2 perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam2/perf.yaml), default "tiny" per [model.py](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam2/model.py)
- A SAM2-Tiny Core ML port is **76 MB** (image encoder 64 MB + prompt encoder 2 MB + mask decoder 9.8 MB), Apache-2.0 — [john-rocky/CoreML-Models](https://github.com/john-rocky/CoreML-Models)
- **EdgeSAM** (RepViT encoder, 9.6M params, 22.1 GFLOPs): COCO mask AP **42.2** (box prompts from ViTDet-H), **38.7 FPS on iPhone 14** (Core ML, encoder + decoder). For comparison on the same table: MobileSAM 39.4 AP / 9.8M / **4.9 FPS**, SAM ViT-H 46.1 AP / 641.1M, FastSAM 37.9 AP / 68.2M — [chongzhou96/EdgeSAM](https://github.com/chongzhou96/EdgeSAM)
- **License flag:** EdgeSAM uses the **S-Lab License 1.0**, which covers "redistribution and use for **non-commercial purpose**" — [EdgeSAM LICENSE](https://github.com/chongzhou96/EdgeSAM/blob/master/LICENSE)
- **MobileSAM** (Apache-2.0) uses a TinyViT encoder (~5M) and mask decoder (3.876M), taking ~12 ms/image on a GPU (8 ms encoder + 4 ms decoder). ONNX export is available — [ChaoningZhang/MobileSAM](https://github.com/ChaoningZhang/MobileSAM). The Core ML port is 23 MB (encoder 13 MB + decoder 9.8 MB) — [CoreML-Models](https://github.com/john-rocky/CoreML-Models). QAI Hub encoder timings are **inconsistent across runtimes**: 74.7 ms (ONNX) vs 538–678 ms (TFLite/QNN) on S25 — [QAI Hub mobilesam perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/mobilesam/perf.yaml)
- **EfficientSAM** (Meta, Apache-2.0) comes in -S and -Ti sizes, with ONNX encoder/decoder available — [yformer/EfficientSAM](https://github.com/yformer/EfficientSAM). It is an official ExecuTorch computer-vision example for "promptable segmentation" — [pytorch/executorch README](https://github.com/pytorch/executorch)
- **EfficientViT-SAM** (MIT Han Lab, Apache-2.0). L0: 512 px, COCO mAP 45.7, LVIS 41.8, **34.8M** params, **8.2 ms on Jetson Orin**. L2: 61.3M, 46.6 mAP, 12.9 ms. XL1: 1024 px, 203.3M, 47.8 mAP, 37.2 ms. It matches or beats SAM-ViT-H zero-shot at 48.9× TensorRT A100 speedup — [efficientvit_sam README](https://github.com/mit-han-lab/efficientvit/blob/master/applications/efficientvit_sam/README.md)
- **FastSAM** is a YOLOv8-seg "segment everything" model under **AGPL-3.0** — [CASIA-IVA-Lab/FastSAM](https://github.com/CASIA-IVA-Lab/FastSAM). FastSAM-S takes **3.9 ms (S25) / 5.2 ms (S24)** TFLite on NPU — [QAI Hub fastsam_s perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/fastsam_s/perf.yaml)

**Open-vocabulary detection/segmentation**
- **YOLOE** (ICCV 2025, **AGPL-3.0**) supports text, visual and prompt-free prompting in one model. LVIS minival fixed AP (text prompt): YOLOE-11-S **27.5** (10M params), -M 33.0, -L 35.2. LVIS val mask AP (text): 11-S 17.6, 11-L 22.6. Prompt-free (built-in vocabulary, no language model): 11-L 26.3 AP. YOLOE-v8-S beats YOLO-Worldv2-S by 3.5 AP with 1.4× speedup. FPS is measured on T4/TensorRT and **iPhone 12/Core ML** — [THU-MIG/yoloe](https://github.com/THU-MIG/yoloe)
- On phone NPUs, YOLOE-seg (default yoloe-v8l-seg) takes **16.3 ms FP32 / 4.9 ms W8A8 on Galaxy S25** and 21.0 / 6.1 ms on S24 (TFLite) — [QAI Hub yoloe_seg perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/yoloe_seg/perf.yaml), [model.py](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/yoloe_seg/model.py). A YOLOE-11s-seg Core ML port is **20 MB** — [CoreML-Models](https://github.com/john-rocky/CoreML-Models)
- **YOLO-World** is **GPL-3.0** — [AILab-CVC/YOLO-World LICENSE](https://github.com/AILab-CVC/YOLO-World). Its Core ML port has a 25 MB detector plus a 121 MB CLIP ViT-B/32 text encoder — [CoreML-Models](https://github.com/john-rocky/CoreML-Models)
- **Grounding DINO** (original) is Apache-2.0 with **52.5 AP** COCO zero-shot (48.5 for the reproducible eval) — [IDEA-Research/GroundingDINO](https://github.com/IDEA-Research/GroundingDINO). **Grounding DINO 1.5/1.6 Pro are API-only** (token application, paid quota via DeepDataSpace). 1.6 Pro reports 55.4 AP COCO and 57.7 AP LVIS-minival zero-shot — [Grounding-DINO-1.5-API](https://github.com/IDEA-Research/Grounding-DINO-1.5-API). That **violates the no-paid-API constraint**.
- **Grounded-SAM-2** combines Grounding DINO (or Florence-2 / DINO-X) with SAM 2 for text→box→mask — [IDEA-Research/Grounded-SAM-2](https://github.com/IDEA-Research/Grounded-SAM-2)
- **RF-DETR-Seg** (Roboflow, DINOv2 backbone, **Apache-2.0** for N–2XL seg models). COCO mask AP50:95: Seg-N **40.3** (3.4 ms, 33.6M, 312 px), Seg-S 43.1 (4.4 ms), Seg-M 45.3 (5.9 ms), Seg-L 47.1 (8.8 ms). The same table has YOLO26-N-Seg 34.7 (2.31 ms, 2.7M), -S 40.2, -L 45.5 (AGPL-3.0). All are measured on NVIDIA T4, TensorRT FP16, batch 1. Detection XL/2XL models are under "PML 1.0", not Apache — [roboflow/rf-detr README](https://github.com/roboflow/rf-detr)
- On phone NPUs, YOLO26-seg (QAI Hub supports n/s/m/l) takes **3.5 ms FP32 on S25** and 4.1 ms on S24 (TFLite) — [QAI Hub yolo26_seg perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/yolo26_seg/perf.yaml)

**Food-specific segmentation SOTA**
- FoodSeg103 has **7,118 images, 104 ingredient classes**, ~6 ingredient masks per image. Official baselines reach up to **45.1 mIoU** (ViT-B/16 + MLA), and Swin-B UperNet gets 41.2. The code is Apache-2.0 — [LARC-CMU-SMU/FoodSeg103-Benchmark-v1](https://github.com/LARC-CMU-SMU/FoodSeg103-Benchmark-v1)
- **FoodSAM** (SAM + semantic segmenter + detector; Apache-2.0) gets **46.42 mIoU on FoodSeg103** (vs SETR-MLA 45.10) and **66.14 on UEC-FoodPix Complete** (vs DeepLabV3+ 65.61). It supports instance, panoptic and promptable food segmentation — [jamesjg/FoodSAM](https://github.com/jamesjg/FoodSAM)
- **IngredSAM** reports 48.78 mIoU on FoodSeg103 and 70.21 on UEC-FoodPix Complete — [J. Imaging 2024 / PMC11677470](https://pmc.ncbi.nlm.nih.gov/articles/PMC11677470/) (search excerpt)
- **HDF** (hybrid decoding with co-occurrence awareness) reports **52.25 mIoU on FoodSeg103** and **76.16 mIoU on UEC-FoodPix Complete** — [PubMed 41683119](https://pubmed.ncbi.nlm.nih.gov/41683119/) (search excerpt)
- **Mask2Former (Swin-L) + LIM-Q** (LLM-derived ingredient labels) reports **55.0 mIoU on FoodSeg103**, the highest I found — [arXiv 2607.25820](https://arxiv.org/html/2607.25820) (search excerpt). Note: it uses an LLM at training/label-derivation time.
- UEC-FoodPix Complete has 10,000 images (9,000 train / 1,000 test), 102 dishes + background, and manually refined masks — [UEC-FoodPix Complete (ICPR 2020)](https://link.springer.com/chapter/10.1007/978-3-030-68821-9_51) (search excerpt)
- A new large benchmark, DishSeg24k, appeared in July 2026 — [arXiv 2607.23070](https://arxiv.org/html/2607.23070) (title only; no numbers retrieved)

### Inferences
- FoodSeg103's best numbers (~46–55 mIoU) come from heavy server models (Swin-L Mask2Former, SAM ViT-H pipelines). A phone model will be lower. The FoodSeg103 ingredient granularity (104 classes) is also finer than a macro app needs.
- A dish/item-level instance segmenter trained on your own classes is the pragmatic choice. It could be RF-DETR-Seg-N/S (Apache-2.0, ~34M params) or YOLO26-seg / YOLOE fine-tuned (AGPL: a closed-source app needs an Ultralytics commercial license).
- A plausible hybrid that fits a <150 ms phone budget:
  1. YOLOE/RF-DETR-Seg proposes boxes and coarse masks (~5–20 ms on NPU);
  2. SAM 2.1-tiny or EfficientViT-SAM-L0 refines the mask per box (~40–120 ms encoder once per image + ~1–4 ms per item);
  3. an embedding classifier assigns the final label.
- SAM 3 is the best "auto-labeler" to bootstrap a Brazilian food dataset on a GPU server (text prompts like "rice", "black beans", "farofa"). Its masks can then train the small on-device model. This keeps inference at zero API cost.
- Commercial-safe SAM options: SAM 2/2.1 (Apache), MobileSAM (Apache), EfficientSAM (Apache), EfficientViT-SAM (Apache), SAM 3 (custom SAM License, commercial allowed with conditions). Avoid EdgeSAM (non-commercial). FastSAM/YOLOE/YOLO26 are AGPL and YOLO-World is GPL.

### Gaps
- No published mobile latency for EfficientViT-SAM, EfficientSAM or EfficientSAM3 on a phone (only Jetson Orin / GPU).
- I found no benchmark of SAM 3 or YOLOE zero-shot directly on FoodSeg103/UEC-FoodPix (open-vocabulary food mIoU). OVFoodSeg exists ([arXiv 2404.01409](https://arxiv.org/html/2404.01409v1)) but I could not read its numbers.
- Florence-2 (MIT, 0.23B/0.77B) and OWLv2 phone latencies were not retrieved.
- The SAM 3 License text restricts use involving reverse engineering, trade controls and military end uses, and requires passing the license along. I did not find an explicit revenue or user-count cap, but legal review is advised.

---

## 3. Monocular metric depth (Depth Anything V2/3, Depth Pro, Metric3D v2, UniDepth v2, MoGe-2/3) — accuracy, size, license, close-range reliability

### Takeaway
Several open models now output metric depth zero-shot. DA3-Metric-Large, MoGe-2 and Depth Pro have permissive licenses. UniDepth is **CC BY-NC**, and Depth Anything V2 Base/Large metric are **CC BY-NC**. Reported indoor δ1 is high on room-scale benchmarks (e.g., UniDepthV2 98.8 NYUv2 zero-shot, per the authors' own table). However:
- none of the published benchmarks cover 20–60 cm tabletop scenes;
- scale-collapse and absolute-scale errors are an active research problem.

Because volume scales with the cube of any global scale error, monocular metric scale alone is **not** reliable enough for grams. Use relative/affine depth for shape and fix scale with a reference: plate diameter, a card, or phone LiDAR/ToF via ARKit/ARCore, optionally fused with Prompt Depth Anything.

### Cited Findings
**Depth Anything V2 (ByteDance/HKU, Jun 2024)**
- Params: Small **24.8M**, Base 97.5M, Large 335.3M, Giant 1.3B ("coming soon") — [DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2)
- **License:** "Depth-Anything-V2-Small model is under the Apache-2.0 license. Depth-Anything-V2-Base/Large/Giant models are under the CC-BY-NC-4.0 license." — [same README](https://github.com/DepthAnything/Depth-Anything-V2)
- Metric variants are fine-tuned on Hypersim (indoor, `max_depth=20` m) and Virtual KITTI 2 (outdoor, 80 m) for Small/Base/Large. The authors recommend "larger models … and the indoor version" — [metric_depth README](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth). A GitHub issue asks about metric model licenses — [Issue #245](https://github.com/DepthAnything/Depth-Anything-V2/issues/245)
- Apple's official Core ML port (DepthAnythingV2 Small): F16 is **49.8 MB**, 6-bit palettized F16P6 is **19 MB**. Inference takes **26.21 ms on iPhone 16 Pro** (iOS 18.3) and **33.90 ms on iPhone 15 Pro Max** (iOS 17.4), all compute units — [Apple Core ML Models gallery](https://developer.apple.com/machine-learning/models/)
- On Snapdragon NPUs (Small-hf, 518×518), it takes **21.5 ms (S25)** and 30.9 ms (S24) FP32 TFLite, and **14.6 ms (S25)** W8A16 ONNX — [QAI Hub depth_anything_v2 perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v2/perf.yaml), weights per [model.py](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v2/model.py)

**Depth Anything 3 (ByteDance Seed, released 2025-11-14; ICLR 2026 Oral per a Core ML port page)**
- Variants: DA3-Small 0.08B and DA3-Base 0.12B are **Apache-2.0**. DA3-Large (0.35B), DA3-Giant (1.15B), Nested-Giant-Large (1.40B) and the 1.1 versions are **CC BY-NC 4.0**. **DA3METRIC-LARGE (0.35B) and DA3MONO-LARGE (0.35B) are listed as Apache-2.0** — [ByteDance-Seed/Depth-Anything-3 README](https://github.com/ByteDance-Seed/Depth-Anything-3)
- There are no small or base metric models; DA3METRIC-LARGE is the only monocular metric option. Metric depth needs camera intrinsics: `metric_depth = focal * net_output / 300`, with focal in pixels. DA3NESTED output is already in meters — [same README](https://github.com/ByteDance-Seed/Depth-Anything-3)
- **Conflict:** FiftyOne's model zoo lists "depth-anything-v3-metric-large-torch" as **CC BY-NC 4.0**, 1.24 GB — [Voxel51 FiftyOne docs](https://docs.voxel51.com/model_zoo/models/depth_anything_v3_metric_large_torch.html). A Hugging Face discussion titled "Licence Clarification" exists for DA3-LARGE — [HF discussion](https://huggingface.co/depth-anything/DA3-LARGE/discussions/2) (not readable here). **Verify the HF model card before commercial use.**
- On phone NPUs, DA3-Small (relative, 518×518) takes **37.1 ms (S25)** and 45.1 ms (S24) FP32 TFLite — [QAI Hub depth_anything_v3 perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v3/perf.yaml), weights DA3-SMALL per [model.py](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v3/model.py). Core ML ports: DA3 Small 504×504 ~44 MB FP16, DA3 Base ~173 MB FP16 (depth + confidence only) — [CoreML-Models](https://github.com/john-rocky/CoreML-Models)

**Depth Pro (Apple, Oct 2024)**
- It produces zero-shot metric depth "without relying on … camera intrinsics", estimates focal length itself, and outputs a 2.25-MP depth map in **0.3 s on a standard GPU** — [apple/ml-depth-pro](https://github.com/apple/ml-depth-pro)
- The architecture uses **three DINOv2 ViT-L/16-384 encoders** (patch encoder, image encoder, FOV encoder) — [depth_pro.py default config](https://github.com/apple/ml-depth-pro/blob/main/src/depth_pro/depth_pro.py). Inference: roughly 3 × ~300M ViT-L, so heavy for phones (param count not verified).
- **License:** code and weights use Apple's sample-code-style license: a "personal, non-exclusive license … to use, reproduce, modify and redistribute the Apple Software, with or without modifications, in source and/or binary forms". It is permissive and not research-only — [ml-depth-pro LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE)
- Accuracy per blog summaries of the paper: SUN-RGBD δ1 **0.89** vs 0.724 for Depth Anything V2; ETH3D AbsRel 0.129 — [Roboflow depth models blog](https://blog.roboflow.com/depth-estimation-models/) (search excerpt). **Conflict:** UniDepth's README table lists Depth Pro SUN-RGBD δ1 as **83.1** — [UniDepth README](https://github.com/lpiccinelli-eth/UniDepth). The two likely use different protocols.

**UniDepth V1/V2 (ETH, V2 released 2025-02-28)**
- V2 backbones: ViT-S, ViT-B, ViT-L. It adds a confidence output, is >30% faster than V1, and has **ONNX export**. The ONNX model has no pre/post-processing and a fixed input shape — [UniDepth README](https://github.com/lpiccinelli-eth/UniDepth), [V2_README](https://github.com/lpiccinelli-eth/UniDepth/blob/main/assets/docs/V2_README.md)
- Zero-shot metric δ1 (%) table in the UniDepth README (authors' own comparison):

  | Model | NYUv2 | SUN-RGBD | ETH3D | IBims-1 | KITTI |
  |---|---|---|---|---|---|
  | UniDepthV2 | 98.8 | 96.4 | 85.2 | 94.5 | 98.9 |
  | UniDepthV1 | 98.4 | 94.3 | 18.5 | 15.7 | 98.6 |
  | Metric3Dv2 | 98.9 | 81.2 | 90.0 | 68.4 | 98.5 |
  | DepthPro | – | 83.1 | 39.7 | 82.3 | – |
  | ZoeDepth | 95.2 | 86.7 | 35.0 | 58.0 | 96.5 |

  — [lpiccinelli-eth/UniDepth](https://github.com/lpiccinelli-eth/UniDepth)
- **License:** "This software is released under Creatives Common **BY-NC 4.0**" (non-commercial) — [UniDepth README](https://github.com/lpiccinelli-eth/UniDepth)

**Metric3D v2**
- Models: v2-S (DINOv2-reg ViT-S), v2-L (ViT-L) and v2-g (ViT-giant2), with ONNX checkpoints (dynamic shapes) on HF onnx-community. Code is **BSD-2-Clause** — [YvanYin/Metric3D](https://github.com/YvanYin/Metric3D), [LICENSE](https://github.com/YvanYin/Metric3D/blob/main/LICENSE)
- NYU (the "routing" leaderboard, i.e. **fine-tuned on NYU**, not zero-shot): ViT-L AbsRel **0.047**, δ1 **0.989**; ViT-giant2 AbsRel 0.045, δ1 0.987 — [Metric3D README](https://github.com/YvanYin/Metric3D)

**MoGe-2 / MoGe-3 (Microsoft)**
- MoGe-2 (Jul 2025) outputs metric point map + depth + normals + FoV in one pass. Params: ViT-L 326M, ViT-L-normal 331M, **ViT-B-normal 104M**, **ViT-S-normal 35M**. MoGe-3 (released **2026-08-18**): ViT-g 1.25B, ViT-L 370M. Latency is 60 ms on A100/RTX 3090 FP16 (ViT-L). **Code is MIT**, and there is ONNX support. MoGe-3 depends on Triton-based FlexGEMM (no macOS) — [microsoft/MoGe](https://github.com/microsoft/MoGe)
- The MoGe-2 paper reports outperforming MoGe, UniDepth(V2), Depth Pro and Metric3D V2 on relative geometry and significantly on metric geometry — [MoGe-2, arXiv 2507.02546](https://arxiv.org/pdf/2507.02546) (search excerpt; exact numbers not retrievable). A third-party evaluation found MoGe-2 drops to 18.1 AbsRel / 62.9 δ1 on KITTI, and UniDepth nearly fails on ETH3D (56.9 AbsRel, 14.9 δ1) — ["How to Evaluate Monocular Depth Estimation?" arXiv 2510.19814 / related benchmark](https://arxiv.org/html/2510.19814v1) (search excerpt, attribution uncertain)
- A Core ML port of MoGe-2 ViT-B + normal exists: ~200 MB FP16, 504×504, outputs depth + normal + mask + metric_scale, MIT — [CoreML-Models](https://github.com/john-rocky/CoreML-Models)

**Scale reliability and close-range food evidence**
- "Honey, I Shrunk the Arc de Triomphe!" (Snavely et al., June 2026) documents persistent **scale collapse**: foundation models metrically underestimate distant landmarks. The authors fine-tune MoGe-2 on a new MetricScenes dataset — [arXiv 2606.02379](https://arxiv.org/abs/2606.02379) (search excerpt). This is far-range evidence, but it shows absolute scale is still unsolved.
- **Prompt Depth Anything** (Dec 2024) takes low-res iPhone ARKit LiDAR depth (192×256) as a prompt to produce up to 4K accurate metric depth. Models: Large 340M and Small 25.1M, plus Small-Transparent. Capture requires iPhone 12 Pro or later Pro models. Code is Apache-2.0 — [DepthAnything/PromptDA](https://github.com/DepthAnything/PromptDA) (weights license not stated in README)
- MonoBite (MetaFood CVPR 2025 challenge winner) reaches **MAPE 0.23** for volume from monocular multi-food images — [MonoBite, Springer PRCV](https://link.springer.com/chapter/10.1007/978-981-95-5737-0_3) (search excerpt)
- "Size Matters" (Purdue, Jan 2026) recovers real-scale 3D food models from a single image using foundation-model features to estimate scale, with ~**30% lower mean absolute volume error** than prior methods on two public datasets — [arXiv 2601.20051](https://arxiv.org/html/2601.20051) (search excerpt)
- A food-volume study observed that images taken much closer than the scaling distance produced noticeably larger volume estimates — [search results on food volume via monocular depth](https://link.springer.com/chapter/10.1007/978-3-030-49108-6_38) (search excerpt; attribution uncertain)
- Nutrition5k (Google, CVPR 2021) has **5,006 plates**, with 4 side-angle videos, overhead RGB-D (when available), per-ingredient mass, total mass/calories and fat/protein/carb masses. Released under **CC BY 4.0 (commercial use allowed)** — [google-research-datasets/Nutrition5k](https://github.com/google-research-datasets/Nutrition5k)

### Inferences
- Error-propagation math: with a pinhole camera, a global depth-scale error *s* scales X, Y and Z alike, so volume error ≈ (1+s)³−1. A 10% scale error gives ≈33% volume/grams error, and 20% gives ≈73%. Room-scale δ1 (share of pixels within 25% of truth) near 95–99% therefore does **not** imply gram-level accuracy on a plate.
- Recommended depth strategy, in order of reliability:
  1. Hardware depth where available (iPhone Pro LiDAR / ARKit sceneDepth, Android ToF / ARCore Depth), optionally upsampled with PromptDA-Small (25.1M).
  2. Relative/affine depth from DA V2-Small (Apache, ~20–35 ms on phone) or DA3-Small (Apache), with metric scale from a known reference: standard plate diameter, a fiducial card, or the user entering plate size.
  3. Metric monocular depth (MoGe-2 ViT-S/B MIT; DA3-Metric-Large if the Apache listing holds; Depth Pro on server) only as a prior or fallback with a clear uncertainty band.
- For commercial use: DA V2-Small (Apache), DA3-Small/Base (Apache), DA3METRIC-LARGE (Apache per GitHub, disputed), MoGe-2 (MIT code, weights license to verify on HF), Depth Pro (permissive Apple license) and Metric3D (BSD-2 code) are candidates. Exclude DA V2-Base/Large (incl. metric), DA3-Large/Giant/Nested and UniDepth (all CC BY-NC).
- Phone-feasible metric candidates: MoGe-2 ViT-S (35M) or ViT-B (104M, Core ML port exists), and DA V2-Small metric-Hypersim (24.8M, Apache). Depth Pro (3× ViT-L) and DA3METRIC-LARGE (350M) are better placed on the cheap self-hosted server fallback.

### Gaps
- **No published zero-shot evaluation of any of these models at 20–60 cm tabletop range** was found. NYUv2, SUN-RGBD, iBims-1 and ETH3D are room/building scale. Absolute-scale accuracy at plate distance must be measured in-house, e.g., against iPhone LiDAR or a caliper-measured test set, or on Nutrition5k overhead RGB-D.
- Exact MoGe-2, DA3-Metric and Depth Pro AbsRel/δ1 tables could not be retrieved (arXiv blocked). Depth Pro's parameter count is not verified.
- MoGe-2 and PromptDA weight licenses (HF model cards) were not verified.
- No phone latency was found for MoGe-2, UniDepthV2, Metric3D v2-S or Depth Pro.

---

## 4. Runtimes: Core ML / Core AI / ANE, LiteRT, ONNX Runtime, ExecuTorch, MediaPipe, WebGPU (PWA vs native)

### Takeaway
A native app gets NPU/ANE acceleration: Core ML (and Apple's new Core AI on iOS 27) on iPhone, and LiteRT or ONNX Runtime QNN / ExecuTorch on Android. Measured costs: SAM2-tiny encoder ~40–120 ms, DA V2-Small ~15–35 ms, YOLOE-seg 5–21 ms, CLIP ViT-B/16 ~15–21 ms. That puts a full pipeline around **~0.1–0.25 s per photo on 2024–2025 flagships**. A WebGPU PWA is now viable on iOS 26+ Safari and Chrome/Edge (Transformers.js, ONNX Runtime Web, LiteRT.js) but lacks NPU/ANE access. Expect several times slower speeds and more model-size pain, so it is better as a prototype or fallback than the primary product.

### Cited Findings
**Apple**
- Core ML: DA V2-Small F16 takes **26.21 ms (iPhone 16 Pro)** and **33.90 ms (iPhone 15 Pro Max)** — [Apple Core ML Models](https://developer.apple.com/machine-learning/models/). EdgeSAM gets **38.7 FPS** on iPhone 14 via Core ML, vs MobileSAM 4.9 FPS. EdgeSAM's authors note MobileSAM and EfficientSAM "are not well optimized by on-device AI accelerators like ANE" — [EdgeSAM README](https://github.com/chongzhou96/EdgeSAM), [EdgeSAM paper](https://arxiv.org/pdf/2312.06660) (search excerpt)
- Core ML export caveat: no dynamic-size interpolation, so pre/post-processing (resize/pad) must be done outside the model — [EdgeSAM README export notes](https://github.com/chongzhou96/EdgeSAM)
- **Core AI**: Apple introduced it at WWDC 2026 (June) as the successor to Core ML for iOS 27 / macOS 27, focused on generative AI and LLMs as well as vision models — [InfoQ, June 2026](https://www.infoq.com/news/2026/06/apple-core-ai-wwdc/), [9to5Mac, Mar 2026](https://9to5mac.com/2026/03/01/apple-replacing-core-ml-with-modernized-core-ai-framework-for-ios-27-at-wwdc/). The community model zoo now distinguishes `.aimodel` (Core AI, iOS 27) bundles from `.mlpackage` (Core ML) and points to Core AI for new apps — [john-rocky/CoreML-Models](https://github.com/john-rocky/CoreML-Models)
- A community Core ML zoo already packages MobileSAM (23 MB), SAM2-Tiny (76 MB), FastSAM-s (~23 MB), YOLOE-11s-seg (20 MB), DA3 Small (~44 MB) and MoGe-2 ViT-B (~200 MB), with sample apps (SamKit, MoGe2Demo) — [john-rocky/CoreML-Models](https://github.com/john-rocky/CoreML-Models)

**Android / Qualcomm (measured, Qualcomm AI Hub; ms per inference on NPU)**

| Model (variant, input) | Galaxy S24 | Galaxy S25 | Source |
|---|---|---|---|
| Depth Anything V2 Small (518²), FP32 TFLite | 30.9 | 21.5 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v2/perf.yaml) |
| Depth Anything V2 Small, W8A16 ONNX | 19.8 | 14.6 | same |
| Depth Anything 3 Small (518²), FP32 TFLite | 45.1 | 37.1 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v3/perf.yaml) |
| SAM 2 tiny encoder, FP32 | 119–125 | 103.7 (QNN) | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam2/perf.yaml) |
| SAM 2 tiny encoder, W8A8 | 51–56 | 38–52 | same |
| SAM 2 decoder | 1.3–6 | 1.0–3.6 | same |
| SAM 3 vision backbone (1008²) | ~1,617–1,648 | ~1,290 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/sam3/perf.yaml) |
| SAM 3 head | ~356–360 | ~268–272 | same |
| YOLOE-v8l-seg, FP32 / W8A8 TFLite | 21.0 / 6.1 | 16.3 / 4.9 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/yoloe_seg/perf.yaml) |
| YOLO26-seg, FP32 TFLite | 4.1 | 3.5 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/yolo26_seg/perf.yaml) |
| FastSAM-S, FP32 TFLite | 5.2 | 3.9 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/fastsam_s/perf.yaml) |
| CLIP ViT-B/16, FP32 TFLite | 21.1 | 17.0 | [perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/openai_clip/perf.yaml) |

- The QAI Hub files list ONNX Runtime 1.27.1 and QAIRT 2.50 as tool versions for these jobs, and run TFLite (LiteRT), ONNX (QNN EP) and QNN DLC paths — [depth_anything_v2 perf.yaml](https://github.com/quic/ai-hub-models/blob/main/src/qai_hub_models/models/depth_anything_v2/perf.yaml)
- **LiteRT** (successor of TensorFlow Lite) supports a CPU (XNNPack), GPU (ML Drift, OpenCL/OpenGL/Metal/WebGPU) and NPU "Compiled Model API" with automatic accelerator selection. Android NPU support covers Google Tensor, MediaTek, Qualcomm and others; iOS supports Metal GPU and ANE (marked \*). Stable releases ship every 6–8 weeks — [google-ai-edge/LiteRT](https://github.com/google-ai-edge/LiteRT)
- **ExecuTorch** exports PyTorch models to `.pte` with XNNPACK, Core ML, Qualcomm and other backends. Its README lists computer-vision examples including YOLO26 and **EfficientSAM (promptable segmentation)**, with Android AAR (Maven) and iOS Swift Package distribution — [pytorch/executorch](https://github.com/pytorch/executorch)

**Web / PWA**
- **Safari 26.0 (Sept 2025) ships WebGPU by default on iOS, iPadOS, macOS and visionOS** — [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). iPhones on older iOS do not have it by default — [AppDeveloper Magazine](https://appdevelopermagazine.com/webgpu-in-ios-26/) (search excerpt)
- **LiteRT.js** (Google, launched ~July 2026) runs `.tflite` models in the browser via WebGPU (ML Drift) and WASM. Launch demos include real-time YOLO26 detection and **Depth-Anything-V2 depth from a live webcam** — [Google Developers Blog](https://developers.googleblog.com/litertjs-googles-high-performance-web-ai-inference/), [MarkTechPost, 2026-07-15](https://www.marktechpost.com/2026/07/15/google-releases-litert-js-a-javascript-binding-of-litert-that-runs-tflite-models-in-browsers-via-webgpu/) (search excerpts). There is an open issue: "LiteRT.js / WebGPU: Unexpected error for depth_anything_v2_small" — [LiteRT issue #9481](https://github.com/google-ai-edge/LiteRT/issues/9481)
- **Transformers.js** provides official WebGPU demos, including "Segment Anything WebGPU" — [huggingface/transformers.js-examples](https://github.com/huggingface/transformers.js-examples). Third-party benchmarks report WebGPU 10–15× (and up to 10–100×) faster than WASM depending on model and hardware — [SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/) (search excerpt)
- Metric3D ONNX (ViT-S/L/g, dynamic shapes) was contributed by the Transformers.js maintainer (xenova), which makes it loadable by ONNX Runtime Web / Transformers.js — [Metric3D README](https://github.com/YvanYin/Metric3D)

### Inferences
- Native iOS phone budget per photo (A17/A18-class): DA V2-Small ~26–34 ms, a YOLOE-S/RF-DETR-Seg-N-class segmenter ~5–20 ms, SAM2-tiny ~50–120 ms once plus ~2–5 ms per item, and a CLIP/SigLIP-B embedding ~15–20 ms per crop. Total is **≈150–300 ms for a 5-item plate**. This fits a "take photo → result" UX without any server.
- A PWA is feasible for a demo on iOS 26+ and Chrome Android. However, WebGPU cannot use ANE/Hexagon NPUs; iOS Safari limits memory for large WASM/WebGPU buffers; and the ~50–200 MB of weights must be downloaded and cached. The native path also gives direct access to LiDAR/ARKit depth (critical per Section 3), which the web cannot access.
- Runtime choice per platform:
  - iOS: Core ML now, Core AI for iOS 27+.
  - Android: LiteRT with the NPU Compiled Model API, or ONNX Runtime with the QNN EP.
  - Cross-platform PyTorch-first teams: ExecuTorch.
  - Web fallback: LiteRT.js or Transformers.js.
- A cheap self-hosted fallback (a CPU VPS or small GPU) can run SAM 3 / DA3-Metric-Large / Depth Pro for hard cases or for offline dataset auto-labeling. This stays within the "no paid API" constraint.

### Gaps
- No MediaPipe Tasks model exists for SAM-class or metric depth; its interactive segmenter was not evaluated here.
- No measured WebGPU latencies on iPhone or Android for SAM2 / Depth Anything were found (only desktop embedding benchmarks).
- No Core ML latency on recent iPhones (A18/A19) was found for SAM 2.1-tiny or YOLOE, beyond community ports that list sizes but not timings.
- ExecuTorch vs Core ML head-to-head numbers for vision models on iPhone were not found.

---

## 5. Licenses (models and datasets) — commercial-use flags

### Takeaway
Many "open" models and most food datasets are **non-commercial**. A commercial-safe core stack exists:
- **Segmentation:** SAM 2.1 (Apache), MobileSAM, EfficientSAM, EfficientViT-SAM or RF-DETR-Seg (all Apache).
- **Depth:** DA V2-Small / DA3-Small/Base (Apache); MoGe-2 (MIT code); Depth Pro (permissive Apple license).
- **Classification:** SigLIP 2 (CC-BY) or CLIP (MIT).
- **Data:** Nutrition5k (CC BY 4.0).

### Cited Findings
**Non-commercial / research-only (flag)**
- Depth Anything V2 Base/Large/Giant (incl. metric fine-tunes): **CC-BY-NC-4.0** — [DA V2 README](https://github.com/DepthAnything/Depth-Anything-V2)
- Depth Anything 3 Large/Giant/Nested (and 1.1 versions): **CC BY-NC 4.0** — [DA3 README](https://github.com/ByteDance-Seed/Depth-Anything-3). DA3METRIC-LARGE is Apache-2.0 per GitHub but CC BY-NC per FiftyOne — [FiftyOne](https://docs.voxel51.com/model_zoo/models/depth_anything_v3_metric_large_torch.html)
- UniDepth (V1/V2): **CC BY-NC 4.0** — [UniDepth README](https://github.com/lpiccinelli-eth/UniDepth)
- EdgeSAM: **S-Lab License 1.0, non-commercial** — [EdgeSAM LICENSE](https://github.com/chongzhou96/EdgeSAM/blob/master/LICENSE)
- MobileCLIP / MobileCLIP2 weights: **Apple ML Research Model TOU, research purposes only** — [LICENSE_MODELS](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)
- UEC FOOD 256: "can be used only for **non-commercial research purpose**" — [UEC FOOD 256 page](http://foodcam.mobi/dataset256.html) (search excerpt)
- Food-101: images come from Foodspotting and are not owned by ETH. Use beyond "scientific fair use" must be negotiated with the picture owners — [TensorFlow Datasets food101](https://www.tensorflow.org/datasets/catalog/food101), [HF ethz/food101](https://huggingface.co/datasets/ethz/food101) (search excerpts)

**Copyleft (commercial allowed, but source-disclosure obligations)**
- YOLOE, FastSAM: **AGPL-3.0** — [yoloe LICENSE](https://github.com/THU-MIG/yoloe/blob/main/LICENSE), [FastSAM LICENSE](https://github.com/CASIA-IVA-Lab/FastSAM/blob/main/LICENSE). YOLO26-Seg: AGPL-3.0 — [RF-DETR README comparison table](https://github.com/roboflow/rf-detr)
- YOLO-World: **GPL-3.0** — [YOLO-World LICENSE](https://github.com/AILab-CVC/YOLO-World/blob/master/LICENSE)

**Custom but commercial-permitting**
- SAM 3 / 3.1: **SAM License**. It grants a "non-exclusive, worldwide, non-transferable and royalty-free limited license … to use, reproduce, distribute, copy, create derivative works". Conditions: pass on the license; acknowledge SAM in publications; no reverse engineering; trade-control and military exclusions. Weights are gated on HF — [sam3 LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE)
- DINOv3: **DINOv3 License**, with a similar royalty-free grant and trade-control/military restrictions — [dinov3 LICENSE.md](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)
- Depth Pro: Apple license permitting use, modification and redistribution in source/binary — [ml-depth-pro LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE)
- RF-DETR detection XL/2XL: **PML 1.0** (not Apache) — [rf-detr README](https://github.com/roboflow/rf-detr)

**Permissive**
- Apache-2.0: SAM 2/2.1 — [sam2](https://github.com/facebookresearch/sam2); MobileSAM — [LICENSE](https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE); EfficientSAM — [LICENSE](https://github.com/yformer/EfficientSAM/blob/main/LICENSE); EfficientViT(-SAM) — [LICENSE](https://github.com/mit-han-lab/efficientvit/blob/master/LICENSE); Grounding DINO (original) — [LICENSE](https://github.com/IDEA-Research/GroundingDINO/blob/main/LICENSE); RAM++ — [LICENSE](https://github.com/xinyu1205/recognize-anything/blob/main/LICENSE); FoodSAM — [LICENSE](https://github.com/jamesjg/FoodSAM/blob/main/LICENSE); PromptDA code — [LICENSE](https://github.com/DepthAnything/PromptDA/blob/main/LICENSE); EfficientSAM3 — [README](https://github.com/SimonZeng7108/efficientsam3); RF-DETR N–L and all Seg sizes — [README](https://github.com/roboflow/rf-detr); DA V2-Small, DA3-Small/Base, DA3-Mono-Large — [DA V2](https://github.com/DepthAnything/Depth-Anything-V2), [DA3](https://github.com/ByteDance-Seed/Depth-Anything-3)
- MIT: MoGe code — [MoGe LICENSE](https://github.com/microsoft/MoGe/blob/main/LICENSE); MobileCLIP code only — [ml-mobileclip](https://github.com/apple/ml-mobileclip)
- BSD-2-Clause: Metric3D code — [LICENSE](https://github.com/YvanYin/Metric3D/blob/main/LICENSE)
- SigLIP 2: code Apache-2.0, other materials (checkpoints) **CC-BY 4.0** — [README_siglip2](https://github.com/google-research/big_vision/blob/main/big_vision/configs/proj/image_text/README_siglip2.md)
- Nutrition5k dataset: **CC BY 4.0**, "free to share and adapt … even commercially" — [Nutrition5k](https://github.com/google-research-datasets/Nutrition5k)
- FoodSeg103 benchmark code: Apache-2.0. The dataset is distributed as a password-protected download — [FoodSeg103-Benchmark-v1](https://github.com/LARC-CMU-SMU/FoodSeg103-Benchmark-v1)
- **Paid API, excluded by the owner's constraint:** Grounding DINO 1.5/1.6 Pro, DINO-X — [Grounding-DINO-1.5-API](https://github.com/IDEA-Research/Grounding-DINO-1.5-API)

### Inferences
**Suggested zero-API, commercially clean shortlist (to validate):**

| Stage | Phone (primary) | Server fallback / training aid |
|---|---|---|
| Item detection + instance masks | RF-DETR-Seg-N/S (Apache) fine-tuned on own food classes; or YOLO26-seg/YOLOE if AGPL or an Ultralytics license is acceptable | SAM 3/3.1 (SAM License) text-prompted auto-labeling to build the dataset |
| Mask refinement | SAM 2.1-tiny (Apache; ~40–120 ms encoder on NPU) or EfficientViT-SAM-L0 (Apache, 34.8M) | SAM 2.1-large |
| Food label | SigLIP 2 B/16 or CLIP ViT-B/16 embedding + linear/k-NN head on a Brazilian dataset (+ text zero-shot for the long tail) | SigLIP 2 So400m / DINOv3 for re-ranking |
| Depth | LiDAR/ARKit depth if present (+ PromptDA-Small); else DA V2-Small or DA3-Small relative depth + plate/card scale reference; MoGe-2 ViT-S/B as metric prior | Depth Pro, DA3METRIC-LARGE (license to verify), MoGe-2/3 ViT-L |
| Grams → macros | (not a CV model) density tables × volume; nutrient DB lookup | — |

- Some model weights hosted on Hugging Face may carry a different license than the GitHub code (e.g., DA3 metric, MoGe-2, PromptDA). A final legal check on each HF model card is required before shipping.
- Training a Brazilian classifier/segmenter on Food-101 or UEC images for a commercial app carries data-license risk. Nutrition5k (CC BY) plus self-collected or SAM 3-auto-labeled Brazilian photos is the cleaner route.

### Gaps
- HF model-card licenses for DA3METRIC-LARGE, MoGe-2 weights, PromptDA weights, Florence-2 and SAM 2.1 Core ML ports could not be read (HF blocked).
- License terms for Food2K, FoodSeg103 (dataset itself) and UEC-FoodPix Complete were not confirmed from primary pages.
- The Ultralytics commercial ("Enterprise") license pricing was not researched.

# Phone depth and real-world scale for per-item food volume (as of late Sept 2026)

_Method note: the network proxy blocked direct fetches of most primary pages (arxiv.org, ncbi/PMC, JMIR, developers.google.com, snapcalorie.com, chromestatus.com, ISPRS, UEC). The numbers below come from search-engine excerpts of those primary pages, plus one direct GitHub fetch (VolETA repo, immersive-web depth-sensing explainer). Each claim links to the primary URL the excerpt came from. Where an excerpt's attribution was unclear, the claim says so. Treat single-source numbers as "reported", not independently verified._

## Q1. iPhone LiDAR and TrueDepth: specs, accuracy at close range, device coverage, ARKit fusion APIs, food-volume studies

### Takeaway
iPhone LiDAR gives metric depth for every frame, but it is coarse: a 256×192 map fused with RGB at 60 Hz, with roughly ±1 cm absolute accuracy (RMSE about 2 cm on test shapes). That is good enough to fix scale and the table plane, but too coarse for the height of thin or small foods. TrueDepth (front structured light) is sub-millimetre at close range, and the best published phone food study used it: iPhone X, about 13–14% error on weight, energy and macros. LiDAR is still only on iPhone Pro/Pro Max (12 Pro through 17 Pro) and on iPad Pro.

### Cited Findings
**Hardware and API**
- ARKit (since ARKit 4 / WWDC20) exposes `ARFrame.sceneDepth` as an `ARDepthData` holding a `depthMap` (a CVPixelBuffer, metres, measured from the camera plane) and a `confidenceMap`. The LiDAR returns and the wide-camera RGB are fused "using advanced machine learning algorithms" into a dense depth map, which runs at 60 Hz and is available on every ARFrame. — [Apple WWDC20 "Explore ARKit 4"](https://developer.apple.com/videos/play/wwdc2020/10611/); [Apple docs: sceneDepth](https://developer.apple.com/documentation/arkit/arframe/scenedepth); [Apple docs: confidenceMap](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap)
- `smoothedSceneDepth` averages depth measurements over time to reduce frame-to-frame noise. — [Apple docs: smoothedSceneDepth](https://developer.apple.com/documentation/arkit/arframe/smoothedscenedepth)
- The depth map has a lower resolution than the captured image but the same aspect ratio. The highest resolution developers can get is 256×192. — [WWDCNotes: Explore ARKit 4](https://wwdcnotes.com/documentation/wwdc20-10611-explore-arkit-4/); [Apple Developer Forums: lidar resolution](https://developer.apple.com/forums/thread/663691)
- On iPhone, the rear depth map is about 256×192 and the front TrueDepth map about 640×480. iPhone 14 Pro LiDAR at 256×192 "exhibits more noise and lower resolution … high magnitudes of distortion on objects' surfaces", and it adds long-tail noise on object edges when RGB and depth are interpolated together. — [arXiv 2309.13570, Robust 6DoF Pose Estimation Against Depth Noise](https://arxiv.org/pdf/2309.13570)
- The LiDAR operating range is up to about 5 m. — [opencv.ai blog on iPhone LiDAR](https://www.opencv.ai/blog/depth-estimation) (secondary)

**Measured accuracy**
- The iPhone 12 Pro LiDAR can model small objects with side length > 10 cm "with an absolute accuracy of ± 1 cm". — [Luetzenburg et al., Scientific Reports 2021](https://www.nature.com/articles/s41598-021-01763-9)
- Remote Sensing Letters (2026) compared LiDAR across models: point-cloud RMSE to known primitive shapes was 2.05 cm (iPhone 12 Pro) and 2.06 cm (iPhone 15 Pro), with no meaningful generational improvement. The study used 40 scans per phone plus a GeoSLAM ZEB Horizon reference. It also notes that the iPhone 17 Pro moves the LiDAR to the far right of the camera plateau, and that the effect on RGB attribution and drift is unknown. — [Taylor & Francis, Remote Sensing Letters 2026](https://www.tandfonline.com/doi/full/10.1080/2150704X.2026.2720055); [Zenodo dataset](https://zenodo.org/records/21651753)
- TrueDepth (iPhone X structured light) is reported to measure below 1 mm at close range. — [SPIE 2019, Measurement accuracy of the iPhone X TrueDepth sensor](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/11144/1114407/Measurement-accuracy-and-dependence-on-external-influences-of-the-iPhone/10.1117/12.2530544.full). An iPhone 13 Pro TrueDepth face scan compared with CBCT had a mean surface discrepancy of 0.387 ± 0.361 mm, with 83.33% of measurements under 1 mm. — [PMC11592646, EM3D facial scan vs CBCT](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11592646/)
- TrueDepth projects more than 30,000 IR dots and reconstructs the surface from the reflected pattern (a PrimeSense-derived structured-light design). — [Structure.io blog](https://structure.io/blog/the-power-of-pocket-3d-scanning-how-apples-truedepth-transformed-mobile-tech/) (vendor source)

**Device coverage**
- LiDAR has been on every iPhone Pro and Pro Max since the iPhone 12 Pro (2020), through the iPhone 17 Pro and 17 Pro Max. The base iPhones, mini, Plus and the iPhone Air do not have it. — [Wikipedia: iPhone 17 Pro](https://en.wikipedia.org/wiki/IPhone_17_Pro); [Wikipedia: iPhone Air](https://en.wikipedia.org/wiki/IPhone_Air); [SimplyWise device list](https://www.simplywise.com/blog/which-iphones-have-lidar/) (secondary)
- LiDAR is also on iPad Pro, starting with the 2020 model. — [Apple WWDC20 Explore ARKit 4](https://developer.apple.com/videos/play/wwdc2020/10611/); [it-jim iOS 3D reconstruction guide](https://www.it-jim.com/blog/3d-reconstruction-on-ios/)

**Published food-volume studies using iPhone depth**
- Herzig et al., JMIR mHealth 2020. The app used the iPhone X structured-light (TrueDepth) sensor on 48 meals with 128 food items. Mean relative absolute errors were: weight 14.0%, carbohydrate 14.8%, fat 12.3%, protein 13.0%, energy 12.7%. Viewing angle did not change accuracy. Cooked meals did slightly worse than breakfasts and snacks. — [PubMed 32209531](https://pubmed.ncbi.nlm.nih.gov/32209531/); [JMIR full text](https://mhealth.jmir.org/2020/3/e15294/); [PMC7142738](https://pmc.ncbi.nlm.nih.gov/articles/PMC7142738/)
- LiDARCalorieCam (University of Electro-Communications, 2025, Springer chapter). It estimates food volume and then calories in real time from iPhone LiDAR, with no reference object. Future work named in the paper: moving volume estimation fully on-device, handling unknown categories and complex scenes, and whole-meal bulk estimation. No numeric error figure was available in the excerpts. — [Springer chapter](https://link.springer.com/chapter/10.1007/978-981-95-4398-4_10); [UEC slides](http://mm.cs.uec.ac.jp/pub/conf25/251111fujita_3_ppt.pdf); [UEC research portal](https://www.researchportal.office.uec.ac.jp/esploro/outputs/journalArticle/Mobile-Food-Calorie-Estimation-Using-Smartphone/991002622663507421)
- A 2026 survey ("Food Portion Estimation: From Pixels to Calories") lists the failure modes of smartphone LiDAR and depth systems:
  - reflective or transparent surfaces such as soup and metal cutlery,
  - outdoor sunlight interfering with the IR signal,
  - "low accuracy for smaller objects (such as food)".
  
  — [arXiv 2602.05078](https://arxiv.org/html/2602.05078v1)
- An ISPRS 2026 paper, "iPhone LiDAR-based Volume Estimation of Regular and Irregular Objects", exists, but its numbers could not be retrieved. — [ISPRS Archives XLVIII-M-10-2025](https://isprs-archives.copernicus.org/articles/XLVIII-M-10-2025/91/2026/isprs-archives-XLVIII-M-10-2025-91-2026.pdf)

### Inferences
- A 1–2 cm depth error is small at room scale but large for a 2–4 cm tall mound of rice or a 1 cm slice of chicken. Integrating raw LiDAR height over a mask will give large relative volume errors on flat or small items. LiDAR is best used for:
  - metric scale,
  - the support-plane (plate or table) height,
  - camera pose,
  
  while fine surface shape comes from RGB (dense monocular depth rescaled to LiDAR, or multi-view).
- At 256×192, an item 5 cm wide at 30 cm distance covers only about 10–15 depth pixels across. This is a rough estimate that assumes the depth map spans the wide camera's roughly 70° horizontal field of view. So segmentation-mask edges, where the long-tail edge noise sits, dominate the error.
- TrueDepth is far more accurate at close range, but it faces the user. Capturing a plate means flipping the phone over the food, as in Herzig et al. That is awkward UX, but the best-validated phone food study (about 13% energy error) used exactly this sensor.
- LiDAR gives no advantage between iPhone 12 Pro and 15 Pro generations (RMSE about 2.05 cm on both), so newer Pro models should not be expected to fix accuracy.

### Gaps
- No source found gives LiDAR depth error in millimetres specifically at 20–60 cm on small (< 10 cm) objects. The ±1 cm figure is for objects > 10 cm, and the 2 cm RMSE is from larger-scale geoscience scans.
- The LiDAR minimum working distance was not found in an accessible primary source.
- Numeric volume and calorie errors for LiDARCalorieCam and the ISPRS 2026 study were not retrievable.
- No data found on the share of the active iPhone base that has LiDAR (Pro vs non-Pro installed base).

## Q2. Android: ARCore Depth API (depth-from-motion, ToF merge), accuracy, device coverage, ToF share

### Takeaway
The ARCore Depth API is broadly available: Google says over 87% of active Android devices as of October 2025. On most devices it is depth-from-motion, not hardware depth. Google states it is most accurate at 0.5–5 m, which is outside the 20–40 cm range of a typical plate shot, and it degrades on textureless surfaces. Hardware ToF has largely disappeared from Android flagships since about 2021. No reliable percentage for ToF share was found.

### Cited Findings
- The Depth API uses a depth-from-motion algorithm. It compares multiple frames from different viewpoints as the user moves the phone, "selectively uses machine learning to increase depth processing, even with minimal motion", and gives per-pixel distance. — [ARCore: Depth adds realism](https://developers.google.com/ar/develop/depth)
- "As of October 2025, over 87% of active Android devices support the Depth API." — [ARCore Depth overview](https://developers.google.com/ar/develop/depth)
- "Depth data is most accurate when the device is half a meter to about five meters away." Experiences that encourage device movement give better results, and featureless surfaces (such as white walls) give imprecise depth. — [ARCore Depth overview](https://developers.google.com/ar/develop/depth); [ARCore Java depth developer guide](https://developers.google.com/ar/develop/java/depth/developer-guide)
- A ToF sensor is not required. If a device has one, ARCore "automatically merges data from all available sources". — [ARCore Depth overview](https://developers.google.com/ar/develop/depth)
- ARCore also has a Raw Depth API, which returns unsmoothed depth with a confidence image. — [ARCore Raw Depth (AR Foundation)](https://developers.google.com/ar/develop/unity-arf/depth/raw-depth)
- Room-scale error for mobile AR depth: ARCore DepthLab showed about 78 cm mean absolute error, compared with 20 cm for the research system InDepth. This is scene-scale, not tabletop. — [InDepth, Zhang et al. 2022](https://3dvar.com/Zhang2022InDepth.pdf) (via the [Mobile AR Depth Estimation survey, arXiv 2310.14437](https://arxiv.org/html/2310.14437))
- On ToF decline:
  - Samsung dropped 3D ToF after the Galaxy S10 5G and S20 Ultra: none on the Note 20 Ultra, S21 or S22, with laser AF used instead. The Galaxy S20 indirect ToF had about 3 m range vs Apple's about 5–6 m. — [Android Authority](https://www.androidauthority.com/samsung-galaxy-s22-3d-tof-1218930/); [GSMArena](https://www.gsmarena.com/report_samsung_considered_bringing_back_the_3d_tof_sensor_for_the_galaxy_s22_decided_against_it-news-48719.php); [SamMobile](https://www.sammobile.com/news/galaxy-s21-lack-tof-samsung-has-not-given-up-tof-concept/)
  - "By 2023, ToF had become a feature that appeared selectively on specific models for specific reasons, not a default flagship expectation." — [Princeton Lightwave, ToF in 2026](https://princetonlightwave.com/the-quiet-repositioning-of-3d-sensing-in-consumer-electronics-where-tof-actually-stands-in-2026/) (industry blog; secondary)

### Inferences
- For a plate at 25–40 cm, ARCore depth-from-motion runs below Google's stated best range and on low-texture foods such as rice, mashed potato, soups and sauces. Expect it to be much less reliable than iPhone LiDAR for per-item height.
- On Android, ARCore is still very valuable for:
  - metric camera poses (the VIO/IMU scale) across a short sweep,
  - plane detection of the table,
  
  which multi-view reconstruction can use for scale (see Q4, VolE).
- Android ToF cannot be counted on. A product should treat Android as "RGB + ARCore poses/planes", with ARCore depth as a weak, optional prior.

### Gaps
- No published close-range (< 50 cm) accuracy figures for ARCore depth on tabletop objects were found.
- ARCore depth image resolution per device was not retrieved from an accessible primary source.
- No reliable market-share percentage of Android devices with ToF (2025–2026) was found. Only qualitative decline is documented.

## Q3. Monocular images + scale anchors (plate, credit card, hand, AR plane + intrinsics, IMU): reported accuracy

### Takeaway
A single RGB image needs an external scale cue. Explicit fiducials (a credit card or checkerboard) work in labs, with under 10% error, but users often occlude or forget them. Implicit priors (typical plate or utensil sizes, learned food priors) are more convenient but less accurate. Estimating plate size alone gave about 10.7% MAPE, and that linear error roughly triples when cubed into volume. The newest research (2025–2026) combines foundation-model depth or features with priors. Examples:
- MetaFood 2025, implicit-scale: best 21% volume MAPE.
- A July 2026 paper adding a DINOv2 geometry head to a multimodal LLM: 33–41% less portion error than the LLM alone.

### Cited Findings
- Nutrition5k (Google, CVPR 2021) calorie prediction:
  - RGB-only direct prediction: 70.6 kcal MAE (26.1% MAPE).
  - Depth as a 4th input channel: 47.6 kcal (18.8%).
  - Depth-derived volume scalar: 41.3 kcal (16.5%).
  - Depth-derived volume also cut mass error from 18.7% to 13.7%.
  
  — [Nutrition5k, arXiv 2103.03375](https://arxiv.org/pdf/2103.03375); [ar5iv HTML](https://ar5iv.labs.arxiv.org/html/2103.03375)
- Two-view 3D reconstruction with a credit-card-sized reference card reportedly achieved under 10% average error in 5.5 s per dish. This is from a search excerpt, attributed to the Dehais et al. two-view method. — [Two-view 3D Reconstruction for Food Volume Estimation, arXiv 1701.03330](https://arxiv.org/pdf/1701.03330)
- Fiducial usability:
  - 91% of adults and 67% of adolescents preferred a credit-card-sized marker.
  - In uncontrolled capture, a checkerboard marker was partly covered by the plate or utensils in 98 of 156 instances.
  - In the goFOOD Lite app, only 1.7% of recordings omitted the whole marker.
  
  — [goFOOD Lite human-factor analysis, JMIR mHealth 2021 / PMC7840289](https://pmc.ncbi.nlm.nih.gov/articles/PMC7840289/); [Image-based portion size estimation without a fiducial marker, Public Health Nutrition](https://pubmed.ncbi.nlm.nih.gov/29623867/)
- Estimating dining-plate size from an egocentric image sequence without a fiducial gave about 10.73% MAPE. — [Frontiers in Nutrition 2020](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2020.519444/full)
- Monocular pipelines such as MonoBite and "Implicit-Scale 3D Reconstruction" (2026) refine global scale with priors from web-crawled statistics of common plates and utensils: object scale = local depth-derived scale × a global correction factor. — [MonoBite, Springer](https://link.springer.com/chapter/10.1007/978-981-95-5737-0_3); [arXiv 2602.13041](https://arxiv.org/html/2602.13041v1)
- A relative (affine-invariant) monocular depth model such as Depth Anything can be made metric by rescaling its predictions to 3D reference points from another sensor. This is the pattern for fusing dense RGB depth with sparse LiDAR or ARKit points. — [arXiv 2412.14103, test-time adaptation for zero-shot metric depth](https://arxiv.org/pdf/2412.14103) (attribution from search excerpt)
- Learned metric volume of fruits and vegetables from short monocular video reportedly reached 16% volume MAPE on untrained objects. The excerpt's attribution is uncertain. — [PMC10073754](https://pmc.ncbi.nlm.nih.gov/articles/PMC10073754/)
- MetaFood 2025 Challenge 1 required inferring scale "from implicit contextual cues rather than explicit physical references" on multi-food scenes with occlusions. The best result was 0.21 MAPE (21%) volume and 5.7 L1 Chamfer. Winners: "Hillo World" (Gu et al.), then "OneVol" (AlMughrabi et al.). — [MetaFood 2025 Challenge 1](https://sites.google.com/view/cvpr-metafood-2025/challenge-1); [arXiv 2602.13041](https://arxiv.org/abs/2602.13041)
- "Geometry-Enhanced Portion Estimation for Multimodal LLMs" (arXiv, 17 July 2026) adds a small portion head on a frozen DINOv2 ViT-S/14 (336 px input). It uses the MLLM's per-food name, bounding box and density range, with no depth sensor and no MLLM fine-tuning. It cut per-food portion error by 33–41% relative to the MLLM alone and beat each benchmark's published image-only model. The authors chose Gemini-3.5-Flash as the best flagship at direct portion estimation. — [arXiv 2607.16514](https://arxiv.org/html/2607.16514)

### Inferences
- Volume scales with the cube of linear scale. A 10% scale error (the plate-size MAPE) becomes about −27% to +33% volume error before any shape error. Explicit metric scale from LiDAR, ARKit or ARCore VIO, or a known card, is therefore the single biggest lever for monocular pipelines.
- The practical scale anchor on a phone is the AR session, not a physical object. ARKit and ARCore give metric camera poses from VIO + IMU and a detected table plane with metric height. With camera intrinsics, this fixes scale without a fiducial on any ARCore or ARKit device, including non-LiDAR iPhones.
- A credit card (85.60 × 53.98 mm, ISO/IEC 7810 ID-1; standard dimension, not from the sources above) is a good fallback where no AR session is possible, for example in a web app on iOS.
- Using the user's hand as a scale anchor: no quantitative accuracy source was found (see Gaps). Hand size varies a lot between people, so it is likely worse than a plate prior unless calibrated once per user.

### Gaps
- No peer-reviewed accuracy figure found for hand-as-reference food volume.
- No study found that directly quantifies "AR plane + intrinsics" single-frame scale error on tabletop food. VolE (Q4) uses AR poses but over a video.
- The monocular metric-depth foundation models (Depth Pro, Metric3D v2, UniDepth, Depth Anything V2-metric) have no food-specific published errors that could be retrieved.

## Q4. Multi-view / short-video capture: SfM, Apple Object Capture, NeRF / neural surfaces / Gaussian splatting; accuracy vs time; MetaFood learnings

### Takeaway
Multi-view reconstruction gives the best food volumes in the literature:
- MetaFood 2024 winner VolETA: about 11% MAPE with a checkerboard for scale.
- VolE, a 2026 method that takes metric scale from ARKit/ARCore poses with no reference object: 2–3% MAPE on its own benchmarks.

The cost is capture effort (a sweep around the plate) and heavy compute (SfM + NeuS2 / 3DGS), which is usually server-side. Apple's Object Capture runs fully on-device on LiDAR iPhones, but it is built for single-object scans, not multi-item plates.

### Cited Findings
- MetaFood CVPR 2024 challenge:
  - Task: volume-accurate 3D food models from 2D images, with a visible checkerboard as the size reference.
  - Participation: 16 teams in the final phase.
  - Metrics: Phase I scored volume MAPE; Phase II scored shape by Chamfer distance.
  - Results: VolETA won overall. FoodRiddle had the best multi-view and single-view reconstructions.
  
  — [MetaFood 2024 report, arXiv 2407.09285](https://arxiv.org/abs/2407.09285); [challenge site](https://sites.google.com/view/cvpr-metafood-2024/challenge)
- VolETA pipeline: flexible camera motion, then Pixel-Perfect SfM, then SAM + XMem++ segmentation, then NeuS2 neural implicit surface. It scored Phase I MAPE 0.10973 (about 11%) across 20 food scenes of varying difficulty, and Phase II Chamfer 0.00726 with the transformation matrix (0.0953 without). — [VolETA GitHub (fetched)](https://github.com/GCVCG/VolETA-MetaFood); [VolETA paper, arXiv 2407.01717](https://arxiv.org/html/2407.01717)
- VolE (Scientific Reports 2026) is reference-free and depth-free:
  - Capture: free-motion video, with images plus per-frame 3D camera coordinates from ARCore/ARKit.
  - Reconstruction: SfM (feature extraction, matching, geometric verification), then FoodMem video segmentation, point-cloud masking, meshing and refinement, then volume from the mesh.
  - Results: 2.22% MAPE overall and 3.08% on easy + medium scenes, with better Chamfer than VolETA.
  
  — [VolE, Scientific Reports](https://www.nature.com/articles/s41598-026-38756-5); [VolE preprint, arXiv 2505.10205](https://arxiv.org/html/2505.10205v1)
- VolTex (CVPR 2025 MetaFood workshop) uses text-guided segmentation and neural surface / 3D Gaussian splatting reconstruction, with scale from a reference object. — [VolTex, CVF Open Access](https://openaccess.thecvf.com/content/CVPR2025W/MTF/papers/AlMughrabi_VolTex_Food_Volume_Estimation_using_Text-Guided_Segmentation_and_Neural_Surface_CVPRW_2025_paper.pdf)
- Food surfaces are often low-texture, which hinders classical multi-view stereo. Gaussian splatting plus an SfM-pose pipeline with a post-hoc scale calibration step is one response to this. — [VolE preprint, arXiv 2505.10205](https://arxiv.org/html/2505.10205v1); [MetaFood3D, arXiv 2409.01966](https://arxiv.org/pdf/2409.01966)
- Mobile 3DGS rendering is now real-time on phones (Mobile-GS, 2026). This covers rendering, not training or reconstruction. — [Mobile-GS, arXiv 2603.11531](https://arxiv.org/pdf/2603.11531)
- Apple Object Capture for iOS (WWDC23, `ObjectCaptureSession`):
  - Reconstruction and export run entirely on-device.
  - LiDAR is recommended "for best results and accurate scale".
  - The session stops capturing once it reaches the device's reconstruction limit.
  - LiDAR data saved in the images is also used by Mac reconstruction.
  
  — [WWDCNotes: Meet Object Capture for iOS](https://wwdcnotes.com/documentation/wwdc23-10191-meet-object-capture-for-ios/); [it-jim iOS 3D reconstruction guide](https://www.it-jim.com/blog/3d-reconstruction-on-ios/); [Vuforia: Apple Object Capture](https://developer.vuforia.com/library/vuforia-engine/images-and-objects/model-targets/using-3d-scans/model-targets-apples-object-capture/)
- MetaFood CVPR 2026 includes a challenge on continuous 3D reconstruction while eating (bite-aware volume). The PerBite paper (arXiv 2606.02021) is related. — [PerBite, arXiv 2606.02021](https://arxiv.org/html/2606.02021)

### Inferences
- Multi-view gives the best accuracy for the least hardware, because ARKit/ARCore VIO poses supply metric scale without any reference object. A 5–15 s sweep around the plate is the practical route to under 10% per-item volume error on any AR-capable phone, not just LiDAR iPhones.
- Compute: NeuS2 / 3DGS / SfM pipelines like VolETA, VolE and VolTex are research code that is typically GPU/server-bound. A product would upload keyframes, poses and masks to a server, or use Apple Object Capture on-device (LiDAR iPhones only), accepting its single-object orientation.
- A hybrid is likely optimal for UX:
  - one-shot capture (LiDAR, or monocular with an AR-plane scale) by default,
  - an optional short sweep for high-accuracy mode or for tall and bowl items.

### Gaps
- End-to-end wall-clock times for VolETA, VolE or VolTex per scene were not in the retrieved excerpts.
- VolE's 2.22% MAPE is on the authors' own datasets. No independent replication was found.
- The full MetaFood 2024 numeric leaderboard (every team's MAPE and single-view vs multi-view split) could not be fetched. The report PDF is on arxiv.org, which was blocked.

## Q5. Computing per-item volume from depth + segmentation: plane fitting, hidden bottoms, bowls, liquids, stacked items; pitfalls

### Takeaway
The standard approach:
1. Back-project the depth map with the camera intrinsics.
2. Fit the support plane (table or plate rim).
3. Integrate height above the plane over each item's mask.

This assumes flat-bottomed, fully visible food. The main known failure modes are:
- reflective or transparent items (soups, glass, metal),
- low texture,
- small or thin items versus coarse depth,
- occlusion in multi-food scenes,
- containers whose inner depth is unknown (bowls, cups).

These need shape or container priors, or multi-view reconstruction.

### Cited Findings
- Smartphone LiDAR/depth food systems fail on reflective or transparent surfaces (soup, metal cutlery), perform poorly outdoors because of IR interference, and are inaccurate for small objects. — [Food Portion Estimation survey, arXiv 2602.05078](https://arxiv.org/html/2602.05078v1)
- ARCore depth is imprecise on surfaces with few or no features. — [ARCore Depth overview](https://developers.google.com/ar/develop/depth)
- iPhone LiDAR at 256×192 adds long-tail noise at object edges when RGB and depth features are interpolated. — [arXiv 2309.13570](https://arxiv.org/pdf/2309.13570)
- ARKit supplies a per-pixel confidence map with depth, meant for filtering low-confidence pixels. — [Apple docs: confidenceMap](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap)
- Multi-food scenes with "diverse object geometries, frequent occlusions, and complex spatial arrangements" are the hard case. The MetaFood 2025 dataset was built to stress this. — [MetaFood 2025 Challenge 1](https://sites.google.com/view/cvpr-metafood-2025/challenge-1)
- Accuracy depends on meal type: cooked meals were worse than breakfasts and snacks with a depth-sensing phone. — [Herzig et al. 2020, PubMed](https://pubmed.ncbi.nlm.nih.gov/32209531/)
- A depth-derived volume scalar cut mass MAE from 18.7% to 13.7% on Nutrition5k. This shows that even imperfect depth volume helps a learned mass regressor. — [Nutrition5k](https://arxiv.org/pdf/2103.03375)

### Inferences
These are engineering reasoning. The specific techniques below were not found stated with numbers in the sources above.
- **Plane fitting:** use RANSAC on the depth points outside the food masks, or use the ARKit/ARCore detected horizontal plane. Fit the plate as a second plane or rim ellipse, because plates have a raised rim and a concave well. Measuring height above the table instead of the plate well over-counts volume by the plate's thickness times the food footprint.
- **Hidden bottoms and overhangs:** single-view height integration assumes each column is solid from the plane up to the visible surface. This over-estimates rounded items (fruit, bread rolls, drumsticks) and under-estimates food under other food. Fixes: multi-view, a shape prior (for example a sphere or ellipsoid for fruit), or a learned volume correction per class.
- **Bowls and cups:** the inside bottom is invisible, so the filled depth is unknown. Options:
  - detect the container and look up or estimate its interior geometry (rim diameter from depth, plus a typical depth/shape prior per bowl class),
  - estimate fill level from the visible liquid surface relative to the rim, then integrate the container's cross-section,
  - ask the user once (small, medium or large bowl).
- **Liquids:** LiDAR/IR may pass through or reflect off liquids and glass (see the survey above). For soups, the surface height from depth is unreliable. Use the rim plane and a fill-level estimate instead.
- **Stacked or mixed items** (salads, stews, sandwiches): the volume is only the visible envelope. Map it to per-ingredient mass with class-level density and composition priors, or treat it as a single composite dish.
- **Density** (g/cm³) converts volume to mass and is its own error source, independent of depth. Nutrition5k-style learned mass heads soften this.

### Gaps
- No retrieved source quantified the error from plate-rim vs table-plane choice, or gave accuracy numbers for bowl-interior or liquid fill-level estimation on phones.
- No retrieved source reported per-category (liquid vs solid vs amorphous) volume error for iPhone LiDAR.

## Q6. Web platform: WebXR depth sensing (iOS Safari vs Android Chrome), getUserMedia limits, PWA vs native

### Takeaway
A web app or PWA cannot get hardware depth on iPhone. iOS Safari still has no handheld WebXR AR in 2026, and depth streams through getUserMedia were abandoned at W3C. On Android Chrome, WebXR `immersive-ar` with the `depth-sensing` feature exposes ARCore depth (mostly depth-from-motion). A PWA is viable for:
- RGB capture plus a reference object or learned priors on all phones,
- ARCore depth and poses on Android Chrome.

Native code (Swift/ARKit, Kotlin/ARCore, or a React Native/Flutter bridge to them) is required for LiDAR/TrueDepth and for iOS AR poses or planes.

### Cited Findings
- iOS Safari does not support WebXR, and "handheld WebXR AR is still not exposed by Safari in 2026 on iPhones". Safari on visionOS 2 enables WebXR `immersive-vr` by default, but not the AR module. Apple has no public timeline for iOS. — [testmu.ai: WebXR browser support 2026](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/) (secondary); [XRDoctors: WebXR on iOS 2026](https://xrdoctors.pro/blog/webxr-on-ios-what-actually-works) (secondary); [caniuse: WebXR](https://caniuse.com/webxr); [Wikipedia: WebXR](https://en.wikipedia.org/wiki/WebXR)
- A WebXR Interop 2026 focus-area proposal has been reported. It was not confirmed as adopted. — [testmu.ai](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/) (secondary; treat as unconfirmed)
- The WebXR Depth Sensing Module is a W3C Working Draft (2025 drafts). — [W3C TR webxr-depth-sensing-1](https://www.w3.org/TR/webxr-depth-sensing-1/); [W3C WD 2025-05-21](https://www.w3.org/TR/2025/WD-webxr-depth-sensing-1-20250521); [Editor's draft](https://immersive-web.github.io/depth-sensing/)
- API shape (explainer, fetched):
  - The session needs `immersive-ar` with `requiredFeatures: ["depth-sensing"]` and preference lists for usage and format.
  - `"cpu-optimized"` access is through `XRFrame.getDepthInformation(view)`, which returns `XRDepthInformation` with `width`, `height`, `getDepthInMeters(x, y)`, `normDepthBufferFromNormView` and `rawValueToMeters`.
  - `"gpu-optimized"` access is through `XRWebGLBinding.getDepthInformation(view)`.
  - `"luminance-alpha"` (uint16) format support is guaranteed. `"float32"` is optional.
  - Occlusion use cases are "more sensitive to the quality of data".
  
  — [immersive-web/depth-sensing explainer](https://github.com/immersive-web/depth-sensing/blob/main/explainer.md)
- Chrome on Android shipped WebXR with the ARCore Depth API (along with Hit Test, Anchors and Lighting Estimation). Chrome uses ARCore for WebXR AR on supported Android devices. — [Google: WebXR compared to ARCore](https://developers.google.com/ar/develop/webxr/arcore-comparison); [Chromium Intent to Ship: WebXR Depth API](https://groups.google.com/a/chromium.org/g/blink-dev/c/v4fneq7tgDA/m/utkwOcjuAwAJ); [ChromeStatus: WebXR Depth API](https://chromestatus.com/feature/5742647199137792)
- Chrome for Android XR (headsets) also supports the Depth Sensing Module, with stereoscopic depth. — [Android Developers: Develop for the web on Android XR](https://developer.android.com/develop/xr/web)
- Media Capture Depth Stream Extensions (depth tracks in getUserMedia) was discontinued by the W3C working group "due to lack of implementation momentum". — [W3C mediacapture-depth](https://w3c.github.io/mediacapture-depth/)

### Inferences
- **iPhone via web:** you only get RGB frames from getUserMedia, with no depth, no ARKit poses or planes, and no reliable metric intrinsics. Scale must come from a reference object (card, known plate), from priors, or from the server-side models in Q3. LiDAR accuracy cannot be reached from Safari.
- **Android via web:** WebXR depth-sensing plus hit-test and plane detection on Chrome gives metric depth and poses. That makes a web version of the VolE-style "AR poses for scale" approach possible on Android, but with ARCore's close-range depth limits.
- **Recommendation logic:** native iOS (Swift ARKit, or an RN/Flutter module wrapping ARKit `sceneDepth`, the ARKit plane anchors and `ObjectCaptureSession`) is required to use LiDAR or TrueDepth and AR poses on iPhone. React Native and Flutter do not expose these out of the box, so a native module or plugin is needed. This is inferred and not verified against a specific plugin list. A PWA works as an MVP only if it accepts reference-object or prior-based scale on iOS.

### Gaps
- The exact Chrome milestone that shipped WebXR depth-sensing was not confirmed. Chrome 90 in 2021 is from memory and unverified, because chromestatus.com was blocked.
- No caniuse page dedicated to WebXR depth-sensing was retrieved.
- No source was found for the current maturity of RN/Flutter ARKit-depth plugins in 2026.

## Q7. SnapCalorie: what it publishes about depth and accuracy

### Takeaway
SnapCalorie (founded by ex-Google Lens co-creator Wade Norris) says it uses depth sensors on compatible iPhone Pro models, plus human reviewers, and cites the Nutrition5k study. Its public accuracy claims are:
- under 20% average calorie error (2023 press),
- about 15% average error (a 2026 third-party review attributing the figure to SnapCalorie).

The peer-reviewed backing is Nutrition5k (Google, CVPR 2021): depth-derived volume improved calorie MAPE from 26.1% (RGB only) to 16.5%. No SnapCalorie-specific LiDAR paper, blog post or patent with per-item volume error was found.

### Cited Findings
- SnapCalorie "leverages depth sensors on compatible devices to gauge portion sizes and employs human reviewers", and it reduces average caloric error "to under 20%". It raised $3M (June 2023). — [TechCrunch 2023](https://techcrunch.com/2023/06/26/snapcalorie-computer-vision-health-app-raises-3m/)
- It was founded by Wade Norris (former Google, co-creator of Google Lens) and Scott Baron (aerospace systems engineer). The App Store listing markets "LiDAR precision for iPhone Pro models to measure exact food volume using depth sensors" and says accuracy is backed by the Nutrition5k study (about 5,000 dishes with every ingredient weighed). — [TechCrunch 2023](https://techcrunch.com/2023/06/26/snapcalorie-computer-vision-health-app-raises-3m/); [App Store: SnapCalorie](https://apps.apple.com/us/app/snapcalorie-ai-calorie-counter/id1574239307)
- A third-party 2026 review says SnapCalorie's published average error is about 15% (about ±150 kcal on a 1,000 kcal meal), based on Nutrition5k validation. — [Macaron review 2026](https://macaron.im/blog/snapcalorie-review-2026) (secondary; not a SnapCalorie primary source)
- Nutrition5k numbers:
  - Calorie MAPE: 26.1% RGB-only, 18.8% with RGB-D 4-channel input, 16.5% with the depth-derived volume scalar.
  - Mass error: 18.7% to 13.7% with the depth volume scalar.
  
  — [Nutrition5k, arXiv 2103.03375](https://arxiv.org/pdf/2103.03375)

### Inferences
- SnapCalorie's depth approach, as publicly described, uses depth as a portion-size signal feeding learned models (the Nutrition5k "volume scalar" pattern), not as an exact per-item geometric volume. The "under 20%" or "about 15%" figures are for whole-meal calories, not per-item cm³.
- Nutrition5k's depth came from a fixed overhead depth camera in a controlled rig, not a phone (from memory: Intel RealSense, about 36 cm overhead; not verified in this session). So its 16.5% may not transfer directly to handheld iPhone LiDAR at 256×192.

### Gaps
- No SnapCalorie engineering blog post, whitepaper or patent describing the LiDAR pipeline (fusion method, plane fitting, per-item error) was found. snapcalorie.com was blocked for fetching, and search returned no such document.
- No independent evaluation of SnapCalorie's LiDAR mode vs its non-LiDAR mode was found.

## Q8 (objective). Which is the most accurate practical route to metric per-item volume (cm³)?

### Takeaway
Ranked by published accuracy:
1. Multi-view with metric AR poses (VolE, about 2–3% MAPE on its benchmarks) or with a reference (VolETA, about 11%).
2. Close-range structured light (TrueDepth: about 13–14% weight/energy error in a 48-meal study).
3. Single-shot LiDAR (coarse ±1–2 cm, weak on small or thin items; no clean food-specific number found).
4. Monocular with implicit scale (about 16–21% volume MAPE in the best 2025–2026 work).
5. Pure MLLM guessing (worst, but improved 33–41% by a geometry head).

The practical design:
- Use a native app.
- Use ARKit/ARCore for metric scale, pose and the table plane on every AR-capable phone.
- Use LiDAR depth as a prior on Pro iPhones.
- Segment per item.
- Offer an optional short sweep for high-accuracy mode or for hard items.

### Cited Findings
- VolE (AR poses, reference-free): 2.22% MAPE. — [Scientific Reports 2026](https://www.nature.com/articles/s41598-026-38756-5)
- VolETA (multi-view, checkerboard): about 11% MAPE, MetaFood 2024 winner. — [VolETA GitHub](https://github.com/GCVCG/VolETA-MetaFood)
- iPhone X TrueDepth app: 14.0% weight and 12.7% energy relative error. — [Herzig 2020](https://pubmed.ncbi.nlm.nih.gov/32209531/)
- Nutrition5k: depth volume scalar gives 16.5% calorie MAPE vs 26.1% RGB-only. — [Nutrition5k](https://arxiv.org/pdf/2103.03375)
- MetaFood 2025, implicit scale, multi-food: best 21% volume MAPE. — [MetaFood 2025](https://sites.google.com/view/cvpr-metafood-2025/challenge-1)
- MLLM + geometry head: 33–41% less portion error than the MLLM alone. — [arXiv 2607.16514](https://arxiv.org/html/2607.16514)
- iPhone LiDAR: about ±1 cm absolute on objects > 10 cm, and about 2.05 cm RMSE on primitives. — [Sci Rep 2021](https://www.nature.com/articles/s41598-021-01763-9); [Remote Sensing Letters 2026](https://www.tandfonline.com/doi/full/10.1080/2150704X.2026.2720055)

### Inferences
- These numbers come from different datasets, metrics (volume MAPE vs weight vs calories) and scene difficulties, so they are not strictly comparable. The ordering is indicative only.
- Web-only products are capped at the "monocular + reference or prior" tier on iPhone. Android Chrome can reach the "AR poses/depth" tier via WebXR.
- Non-LiDAR phones can still get metric scale from VIO (ARKit/ARCore). This makes LiDAR a nice-to-have for accuracy rather than a hard requirement, as long as the app is native or uses WebXR on Android.

### Gaps
- No head-to-head study was found that evaluates LiDAR single-shot vs AR-pose multi-view vs monocular metric depth on the same food dataset with per-item cm³ ground truth, on phones, in 2025–2026.

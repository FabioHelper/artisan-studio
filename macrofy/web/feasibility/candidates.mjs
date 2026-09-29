// Model candidates per stage, tried in order until one loads. Ids are unverified (no huggingface.co
// access when written): the page records which one actually loaded and why the others failed.
// The transformers.js version list (4.3.0, then 3.8.1) and the segmentation and naming candidates are shared with the
// estimate screens in ../lib/models.mjs, so this page exercises exactly what the app will load.
import { TRANSFORMERS_VERSIONS, SEGMENT_CANDIDATES, NAMING_CANDIDATES, BACKENDS, backendsOf } from '../lib/models.mjs';

export { TRANSFORMERS_VERSIONS, BACKENDS, backendsOf };

export const LABELS = ['arroz branco', 'feijão', 'frango grelhado', 'bife', 'salada',
  'batata frita', 'ovo', 'macarrão', 'farofa', 'banana'];

// Order matters: the two stages the estimator needs run first, depth (informational only) last. Each stage runs in its own page load.
export const STAGES = [
  { stage: 'segmentation', title: 'Segmentação', candidates: SEGMENT_CANDIDATES },
  { stage: 'naming', title: 'Nomes dos alimentos', candidates: NAMING_CANDIDATES },
  { stage: 'depth', title: 'Profundidade (informativa)', candidates: [
    { id: 'onnx-community/depth-anything-v2-small', task: 'depth-estimation' },
    { id: 'Xenova/depth-anything-small-hf', task: 'depth-estimation' }] },
];

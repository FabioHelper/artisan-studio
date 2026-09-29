// Model candidates per stage, tried in order until one loads. Ids are unverified (no huggingface.co
// access when written): the page records which one actually loaded and why the others failed.
// The transformers.js version list (4.3.0, then 3.8.1) and the segmentation and naming candidates are shared with the
// estimate screens in ../lib/models.mjs, so this page exercises exactly what the app will load.
import { TRANSFORMERS_VERSIONS, SEGMENT_CANDIDATES, NAMING_CANDIDATES, BACKENDS } from '../lib/models.mjs';

export { TRANSFORMERS_VERSIONS, BACKENDS };

export const LABELS = ['arroz branco', 'feijão', 'frango grelhado', 'bife', 'salada',
  'batata frita', 'ovo', 'macarrão', 'farofa', 'banana'];

export const STAGES = [
  { stage: 'depth', title: 'Profundidade', candidates: [
    { id: 'onnx-community/depth-anything-v2-small', task: 'depth-estimation' },
    { id: 'Xenova/depth-anything-small-hf', task: 'depth-estimation' }] },
  { stage: 'segmentation', title: 'Segmentação', candidates: SEGMENT_CANDIDATES },
  { stage: 'naming', title: 'Nomes dos alimentos', candidates: NAMING_CANDIDATES },
];

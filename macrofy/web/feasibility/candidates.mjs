// Model candidates per stage, tried in order until one loads. Ids are unverified (no huggingface.co
// access when written): the page records which one actually loaded and why the others failed.
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

export const LABELS = ['arroz branco', 'feijão', 'frango grelhado', 'bife', 'salada',
  'batata frita', 'ovo', 'macarrão', 'farofa', 'banana'];

export const STAGES = [
  { stage: 'depth', title: 'Profundidade', candidates: [
    { id: 'onnx-community/depth-anything-v2-small', task: 'depth-estimation' },
    { id: 'Xenova/depth-anything-small-hf', task: 'depth-estimation' }] },
  { stage: 'segmentation', title: 'Segmentação', candidates: [
    { id: 'onnx-community/sam2.1-hiera-tiny-ONNX', sam: 'Sam2Model' },
    { id: 'Xenova/slimsam-77-uniform', sam: 'SamModel' }] },
  { stage: 'naming', title: 'Nomes dos alimentos', candidates: [
    { id: 'onnx-community/siglip2-base-patch16-224-ONNX', task: 'zero-shot-image-classification' },
    { id: 'Xenova/siglip-base-patch16-224', task: 'zero-shot-image-classification' }] },
];

// Tried in order per candidate; WebGPU entries are skipped when the browser has no WebGPU adapter.
export const BACKENDS = [['webgpu', 'fp16'], ['webgpu', 'q8'], ['wasm', 'q8']];

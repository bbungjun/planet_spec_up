import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Expected exactly one SDK anchor: ${before.slice(0, 90)}`);
  return source.replace(before, after);
}

/** Reconstruct the installed, pinned SDK in ignored output. Never edit node_modules.
 * A source-equivalent control is required: rebuilding can itself change behavior/cost.
 * The prototype materializes OpenCV crops and normalized floats per inference group.
 */
export function prepareSdkVariant(appRoot, outputRoot, stream) {
  const packageRoot = path.join(appRoot, 'node_modules/@paddleocr/paddleocr-js');
  const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
  if (version !== '0.4.2') throw new Error(`Review the SDK prototype for version ${version}`);
  const dest = path.join(outputRoot, stream ? 'sdk-stream' : 'sdk-control');
  const maps = ['dist/index.mjs.map', ...fs.readdirSync(path.join(packageRoot, 'dist/assets')).filter(n => n.endsWith('.js.map')).map(n => `dist/assets/${n}`)];
  const sources = new Map();
  for (const file of maps) {
    const map = JSON.parse(fs.readFileSync(path.join(packageRoot, file), 'utf8'));
    map.sources.forEach((source, i) => {
      if (!source.startsWith('../src/') || !map.sourcesContent[i]) return;
      const relative = source.slice('../src/'.length);
      if (relative.includes('..')) throw new Error('Invalid source path');
      if (sources.has(relative) && sources.get(relative) !== map.sourcesContent[i]) throw new Error(`Conflicting SDK source: ${relative}`);
      sources.set(relative, map.sourcesContent[i]);
    });
  }
  // Barrel files are tree-shaken out of source maps. Their shipped declarations
  // contain only re-exports and can be used verbatim as TypeScript source.
  for (const relative of ['index.ts', 'models/index.ts', 'resources/index.ts']) {
    sources.set(relative, fs.readFileSync(path.join(packageRoot, 'dist', relative.replace(/\.ts$/, '.d.ts')), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, ''));
  }
  const before = sources.get('models/rec.ts');
  const coreBefore = sources.get('pipelines/ocr/core.ts'), cropBefore = sources.get('pipelines/ocr/crop.ts');
  if (stream) {
    let rec = replaceOnce(before,
      '      const samples = preprocess(ctx, mats);\n      const charDict = config.charDict;\n      const ordered = samples.slice().sort((a, b) => a.width - b.width);',
      `      const charDict = config.charDict;
      // Use the exact preprocessSample width formula and stable ordering.
      // Preserve inference group membership/padding; materialize floats per group.
      const [, targetHeight, baseWidth] = config.imageShape;
      const ordered = mats.map((mat, inputIndex) => ({ mat, inputIndex,
        width: clamp(Math.trunc(targetHeight * Math.max(baseWidth / Math.max(1, targetHeight), mat.cols / Math.max(1, mat.rows))), 1, MAX_REC_WIDTH)
      })).sort((a, b) => a.width - b.width);`);
    rec = replaceOnce(rec,
      '      for (const batch of chunkArray(ordered, batchSize)) {\n        const inputTensor = packRecBatchTensor(ort, batch, targetH);',
      '      for (const group of chunkArray(ordered, batchSize)) {\n        const batch = group.map(({ mat, inputIndex }) => preprocessSample(ctx, mat, inputIndex));\n        const inputTensor = packRecBatchTensor(ort, batch, targetH);');
    rec = replaceOnce(rec, 'const MAX_REC_WIDTH = 3200;', `const MAX_REC_WIDTH = 3200;
export function recognitionWidthForShape(config: RecModelConfig, width: number, height: number): number {
  const [, targetH, baseW] = config.imageShape;
  return clamp(Math.trunc(targetH * Math.max(baseW / Math.max(1, targetH), width / Math.max(1, height))), 1, MAX_REC_WIDTH);
}`);
    sources.set('models/rec.ts', rec);

    // Reuse exactly the installed geometry/rotation rules to sort descriptors
    // before allocating crops. The actual crop function remains unchanged.
    const geometryStart = cropBefore.indexOf('  const ordered =');
    const geometryEnd = cropBefore.indexOf('\n  const srcTri =');
    if (geometryStart < 0 || geometryEnd < geometryStart) throw Error('Review crop geometry anchors');
    sources.set('pipelines/ocr/crop.ts', cropBefore + `
export function cropDimensions(cv: OpenCv, poly: Point2D[]): { width: number; height: number } {
${cropBefore.slice(geometryStart, geometryEnd)}
  return cropH / cropW >= 1.5 ? { width: cropH, height: cropW } : { width: cropW, height: cropH };
}
`);
    let core = replaceOnce(coreBefore, 'import { cropByPoly } from "./crop";', 'import { cropByPoly, cropDimensions } from "./crop";\nimport { recognitionWidthForShape } from "../../models/rec";');
    const blockStart = core.indexOf('          const cropMats: Mat[] = [];');
    const blockEnd = core.indexOf('\n        }\n\n        sumRecMs', blockStart);
    if (blockStart < 0 || blockEnd < blockStart) throw Error('Review pipeline crop anchors');
    core = replaceOnce(core, core.slice(blockStart, blockEnd), `          const ordered = detBoxes.map((box, inputIndex) => {
            const size = cropDimensions(cv, box.poly);
            return { box, inputIndex, width: recognitionWidthForShape(recModel.config, size.width, size.height) };
          }).sort((a, b) => a.width - b.width);
          const recResults: Array<{ text: string; score: number }> = new Array(detBoxes.length);
          const recBatchSize = Math.max(1, Math.floor(this.pipelineConfig.textRecognitionBatchSize) || 1);
          for (const group of chunkArray(ordered, recBatchSize)) {
            const cropMats: Mat[] = [];
            try {
              for (const value of group) cropMats.push(cropByPoly(cv, sourceImages[imgIdx].mat, value.box.poly));
              const decoded = await recModel.predict(cv, cropMats);
              for (let i = 0; i < group.length; i++) recResults[group[i].inputIndex] = decoded[i];
            } finally {
              for (const mat of cropMats) mat.delete();
            }
          }
          const items: OcrResultItem[] = [];
          for (let boxIdx = 0; boxIdx < recResults.length; boxIdx++) {
            const rec = recResults[boxIdx];
            if (rec.text && rec.score >= resolved.pipeline.scoreThresh) items.push({ poly: detBoxes[boxIdx].poly, text: rec.text, score: rec.score });
          }
          perImageItems.push(items);`);
    sources.set('pipelines/ocr/core.ts', core);
  }
  for (const [relative, text] of sources) {
    const target = path.join(dest, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
  }
  const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
  return { entry: path.join(dest, 'index.ts'), version, stream, sourceCount: sources.size,
    originalRecSha256: sha256(before), variantRecSha256: sha256(sources.get('models/rec.ts')),
    originalCoreSha256: sha256(coreBefore), variantCoreSha256: sha256(sources.get('pipelines/ocr/core.ts')),
    originalCropSha256: sha256(cropBefore), variantCropSha256: sha256(sources.get('pipelines/ocr/crop.ts')) };
}

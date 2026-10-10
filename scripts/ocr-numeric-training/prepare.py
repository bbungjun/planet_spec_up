"""Build local-only, reviewed pilot crops. No OCR-generated labels or random split."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from collections import Counter

from PIL import Image


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(review_path, output):
    review = json.loads(review_path.read_text(encoding='utf-8'))
    app = Path(__file__).resolve().parents[2]
    output = output.resolve()
    if not output.is_relative_to(app / 'output'):
        raise ValueError('Private data must stay under ignored output/')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use an empty output directory; prior crops must not be overwritten')
    output.mkdir(parents=True, exist_ok=True)
    records, source_splits, seen, crops = [], {}, set(), []
    for row in review['rows']:
        if not re.fullmatch(r'[A-Za-z0-9_-]+', row['id']):
            raise ValueError('Sample IDs must be safe filenames')
        if row['id'] in seen:
            raise ValueError('Duplicate sample ID')
        seen.add(row['id'])
        if row['completeness'] != 'complete' or len(row['reviews']) < 2:
            raise ValueError('Only twice-reviewed complete crops may be included')
        if row['split'] not in ('train', 'diagnostic', 'validation', 'test'):
            raise ValueError('Unknown split')
        if row['split'] == 'train' and not row['label'].isascii():
            raise ValueError('Integer pilot requires ASCII labels')
        if row['split'] == 'train' and not row['label'].isdigit():
            raise ValueError('Integer pilot excludes signs and bonus options')
        source = (app / row['source']).resolve()
        if not source.is_relative_to(app):
            raise ValueError('Source outside this workspace')
        source_hash = sha(source)
        # Diagnostic replays are explicitly exposed data, never model selection.
        if row['split'] != 'diagnostic':
            for key in (source_hash, row['sourceGroupId']):
                prior = source_splits.setdefault(key, row['split'])
                if prior != row['split']:
                    raise ValueError('Source or capture group crosses dataset splits')
        im = Image.open(source).convert('RGB')
        x,y,w,h = row['crop']
        if min(x,y) < 0 or min(w,h) < 1 or x+w > im.width or y+h > im.height:
            raise ValueError('Crop extends beyond source')
        crop = im.crop((x,y,x+w,y+h)).resize((w*3,h*3), Image.Resampling.NEAREST)
        dest = output / 'crops' / (row['id'] + '.png')
        crops.append((crop,dest))
        records.append({**row, 'sourceSha256':source_hash,
                        'image':str(dest.relative_to(output)).replace('\\','/')})
    for row,(crop,dest) in zip(records,crops):
        dest.parent.mkdir(exist_ok=True)
        crop.save(dest)
        row['cropSha256']=sha(dest)
    manifest = {'mode':'pilot', 'reviewSha256':sha(review_path), 'rows':records,
                'recipe':'original RGB, manual verified crop, nearest 3x; no character replacement',
                'counts':dict(Counter(r['split'] for r in records)),
                'independentTestCount':sum(r['split']=='test' for r in records)}
    with (output/'manifest.json').open('x',encoding='utf-8') as f:
        json.dump(manifest,f,ensure_ascii=False,indent=2)
    (output/'training.json').write_text(json.dumps({
        'sourceManifestSha256':sha(output/'manifest.json'),
        'rows':[r for r in records if r['split']=='train']},ensure_ascii=False,indent=2),encoding='utf-8')
    # Inference inputs intentionally contain neither labels nor splits.
    (output/'inputs.json').write_text(json.dumps({'rows':[
        {k:r[k] for k in ('id','image','cropSha256')} for r in records]},indent=2),encoding='utf-8')
    print(json.dumps({'counts':manifest['counts'],'uniqueSources':len({r['sourceSha256'] for r in records}),
                      'captureGroups':len({r['sourceGroupId'] for r in records})}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--review',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    prepare(args.review,args.output)

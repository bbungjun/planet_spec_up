"""Freeze prior automatic value extraction, retaining failures in the denominator.

Only the original-color/number-tight inputs are used; there is no per-case choice.
This reuses previously located OCR rows, not an end-to-end fresh image detector.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser()
    for key in ('baseline','study','output'):p.add_argument('--'+key,type=Path,required=True)
    args=p.parse_args();app=Path(__file__).resolve().parents[2];args.output=args.output.resolve()
    if not args.output.is_relative_to(app/'output'):raise ValueError('Private output only')
    if args.output.exists() and any(args.output.iterdir()):raise ValueError('Use a new replay directory')
    data=args.output/'data';(data/'crops').mkdir(parents=True)
    truth={r['id']:r for r in read(args.study/'data/manifest.json')['rows']}
    records=[];failures=[];sources={}
    for prefix,folder in [('dev-',args.baseline),('reg-',args.baseline/'regression')]:
        predictions=read(folder/'result-baseline.json')
        segments=read(folder/'result-segmentation.json')
        if predictions.get('error') or predictions.get('running') or predictions['manifestName']!=segments['manifestName']:
            raise ValueError('Incomplete or mismatched baseline')
        for name in ('result-baseline.json','result-segmentation.json'):
            sources[prefix+name]=sha(folder/name)
        geometry={r['id']:r for r in segments['rows']}
        selected=[r for r in predictions['rows'] if r['profile']=='original-color' and r['variant']=='number-tight']
        if {r['id'] for r in selected}!=set(geometry) or len(selected)!=len(geometry):raise ValueError('Target mismatch')
        for row in selected:
            key=prefix+row['id'];label=truth[key]
            failure=geometry[row['id']].get('failure') or row.get('failure')
            if failure:
                failures.append({**label,'automaticFailure':failure});continue
            dest=data/'crops'/f'{key}.png'
            if not row['preview'].startswith('data:image/png;base64,'):raise ValueError('Expected frozen PNG')
            dest.write_bytes(base64.b64decode(row['preview'].split(',',1)[1],validate=True))
            records.append({**label,'cropSha256':sha(dest),'image':'crops/'+dest.name,
                'completeness':'automatic-locator-only','reviews':[],
                'annotationOrigin':'frozen original-color automatic separation; expected label used only for scoring'})
    manifest={'mode':'automatic-separation-replay','rows':records,'independentTestCount':0,
              'recipe':'frozen OCR rows, existing colon separator, original-color nearest3x, no manual crop repair',
              'sourceHashes':sources,'fullDenominator':len(records)+len(failures),'automaticFailures':failures}
    (data/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (data/'inputs.json').write_text(json.dumps({'rows':[{k:r[k] for k in ('id','image','cropSha256')} for r in records]},indent=2),encoding='utf-8')
    models=read(args.study/'browser-models.json')
    (args.output/'browser-models.json').write_text(json.dumps({k:models[k] for k in ('A1','BN1')},indent=2),encoding='utf-8')
    print(json.dumps({'located':len(records),'extractionFailed':len(failures),'denominator':manifest['fullDenominator']}))


if __name__=='__main__':main()

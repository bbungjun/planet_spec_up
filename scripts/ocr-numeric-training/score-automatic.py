"""Audit full-photo discovery plus frozen numeric models, retaining all failures."""
import argparse
import base64
from collections import Counter,defaultdict
import hashlib
import io
import json
from pathlib import Path
from PIL import Image
from score import score


def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate(run,study):
    app=Path(__file__).resolve().parents[2]
    protocol=read(run/'protocol.json');pipeline=read(run/'pipeline.json');completion=read(run/'complete.json')
    truth=read(study/'data/manifest.json');sealed=read(study/'test-manifest-lock.json')
    if sha(study/'pretest-lock.json')!=protocol['sourceStudySha256']:raise ValueError('Source study changed')
    if sha(study/'data/manifest.json')!=sealed['files']['data/manifest.json']:raise ValueError('Frozen truth changed')
    for name,digest in protocol['sourceHashes'].items():
        if sha(run/'sources'/name)!=digest:raise ValueError('Runtime source snapshot changed')
    for name,model in protocol['models'].items():
        if sha(app/model['path'])!=model['sha256'] or model!=sealed['models'][name]:raise ValueError('Frozen model changed')
    if completion['phase']!='complete' or pipeline['phase']!='pipeline-complete':raise ValueError('Incomplete run')
    expected={r['id']:r for r in truth['rows']};regions=pipeline['regions']
    if Counter(r['id'] for r in regions)!=Counter(expected.keys()):raise ValueError('Full field membership changed')
    if pipeline['fullDenominator']!=len(expected) or completion['fullDenominator']!=len(expected):raise ValueError('Denominator changed')
    fixture_hashes={f['id']:f['sha256'] for f in protocol['fixtures']}
    if Counter(r['source'] for r in pipeline['reviews'])!=Counter(fixture_hashes.keys()):raise ValueError('Missing/duplicate full-photo result')
    located=[];failures=[]
    for row in regions:
        source=expected[row['id']]
        if source['sourceSha256']!=row['sourceSha256'] or fixture_hashes[row['source']]!=row['sourceSha256']:
            raise ValueError('Source identity changed')
        if sha(app/source['source'])!=source['sourceSha256']:raise ValueError('Original source changed')
        if row.get('failure'):failures.append(row);continue
        if not row['preview'].startswith('data:image/png;base64,'):raise ValueError('Missing crop PNG')
        pixels=base64.b64decode(row['preview'].split(',',1)[1],validate=True)
        if hashlib.sha256(pixels).hexdigest()!=row['cropSha256']:raise ValueError('Automatic crop hash changed')
        crop=row['valueCrop']
        with Image.open(io.BytesIO(pixels)) as image:
            if image.size!=(crop['width']*3,crop['height']*3):raise ValueError('Automatic scale changed')
        located.append({**source,'image':'automatic/'+row['id']+'.png','cropSha256':row['cropSha256']})
    if completion['located']!=len(located) or completion['failures']!=len(failures):raise ValueError('Extraction counts differ')
    result={'scope':protocol['scope'],'fullDenominator':len(expected),'located':len(located),'extractionFailed':len(failures),
        'extractionFailures':dict(Counter(r['failure'] for r in failures)),
        'fullPhoto':{'total':len(pipeline['reviews']),'recognitionErrors':sum(not r['ok'] for r in pipeline['reviews']),
            'reviewBlocked':sum(r.get('product',{}).get('blocked',False) for r in pipeline['reviews'] if r.get('product')),
            'reviewAbsent':sum(not r.get('product') for r in pipeline['reviews']),
            'note':'Product review block state is not proof of ground-truth accuracy or successful storage.'},'models':{}}
    outputs={}
    for model in ('A1','BN1'):
        receipt=read(run/(model+'.json'))
        if receipt['phase']!='numeric-complete' or receipt['model']!=model or receipt['batch']!=6:
            raise ValueError('Wrong numeric run')
        if receipt['modelSha256']!=protocol['models'][model]['sha256']:raise ValueError('Inference model changed')
        if not located and receipt['rows']:raise ValueError('Predictions without located crops')
        checked=score({'rows':located},receipt) if located else {'rows':[],'groups':{}}
        outputs[model]=checked['rows'];by_id={r['id']:r for r in checked['rows']}
        grouped=defaultdict(list)
        for row in regions:grouped[row['source']].append(by_id.get(row['id'],{}).get('correct',False))
        subsets={}
        for label,subset in [('zero',[r for r in truth['rows'] if r['label']=='0']),('nonzero',[r for r in truth['rows'] if r['label']!='0'])]:
            subsets[label]={'total':len(subset),'exact':sum(by_id.get(r['id'],{}).get('correct',False) for r in subset),
                'extractionFailed':sum(r['id'] not in by_id for r in subset)}
        metrics=checked['groups'].get('test',{})
        result['models'][model]={'fullDenominator':len(expected),'exact':sum(r['correct'] for r in checked['rows']),
            'locatedMetrics':metrics,'subsets':subsets,'allFiveNumericFields':{'exact':sum(all(v) for v in grouped.values()),'total':len(grouped)},
            'recognitionFailures':[r for r in checked['rows'] if not r['correct']]}
    baseline={r['id']:r for r in outputs['A1']}
    result['changes']={'improved':[r['id'] for r in outputs['BN1'] if r['correct'] and not baseline[r['id']]['correct']],
        'regressed':[r['id'] for r in outputs['BN1'] if not r['correct'] and baseline[r['id']]['correct']]}
    result['unresolvedExtraction']=failures
    result['sourceHashes']={name:sha(run/name) for name in ['protocol.json','pipeline.json','A1.json','BN1.json','complete.json']}
    result['scoringCodeSha256']=sha(Path(__file__))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--run',type=Path,required=True);p.add_argument('--study',type=Path,required=True)
    p.add_argument('--save',default='automatic-score.json');args=p.parse_args()
    if Path(args.save).name!=args.save:raise ValueError('Use an output filename')
    result=evaluate(args.run,args.study)
    with (args.run/args.save).open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in result.items() if k not in ['models','unresolvedExtraction','sourceHashes']},ensure_ascii=True))
    for model,metrics in result['models'].items():print(model,json.dumps({k:v for k,v in metrics.items() if k!='recognitionFailures'},ensure_ascii=True))

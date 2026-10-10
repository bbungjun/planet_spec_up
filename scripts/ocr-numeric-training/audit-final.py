"""Audit a presealed numeric test without inference, selection, or label repair."""
import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path

from score import score


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(run, prior, conversion, weights):
    app=Path(__file__).resolve().parents[2]
    lock=read(run/'test-manifest-lock.json');pre=read(run/'pretest-lock.json')
    sealed=datetime.fromisoformat(lock['createdAtUTC']).timestamp()
    if lock['models']!=pre['models']:raise ValueError('Preselected models changed')
    for name,digest in lock['files'].items():
        if sha(run/name)!=digest:raise ValueError('Sealed artifact changed: '+name)
    for model in lock['models'].values():
        if sha(app/model['path'])!=model['sha256']:raise ValueError('Model changed')
    manifest=read(run/'data/manifest.json');records=manifest['rows']
    if any(r['split']!='test' for r in records):raise ValueError('Test membership changed')
    if read(run/'data/training.json')['rows'] or read(run/'data/validation.json')['rows']:
        raise ValueError('Final labels leaked into learning lists')
    previous=read(prior/'data/manifest.json')['rows']
    for key in ('sourceSha256','sourceGroupId'):
        if {r[key] for r in records}&{r[key] for r in previous}:raise ValueError('Prior source/group overlap')
    frozen={r['sha256'] for r in pre['rows']}
    if {r['sourceSha256'] for r in records}!=frozen:raise ValueError('Source membership changed')
    for row in records:
        if sha(app/row['source'])!=row['sourceSha256'] or sha(run/'data'/row['image'])!=row['cropSha256']:
            raise ValueError('Source/crop changed')
    scored={};receipts={};hashes={};timestamps=[]
    for model in lock['modelOrder']:
        paths=list(run.glob(f'browser-{model}-b6-*.json'))
        if len(paths)!=1:raise ValueError('Require exactly one final receipt per frozen model')
        path=paths[0];timestamp=int(path.stem.rsplit('-',1)[1])/1000
        if timestamp<=sealed:raise ValueError('Inference preceded annotation freeze')
        timestamps.append(timestamp)
        receipt=read(path)
        if receipt.get('phase')!='complete' or receipt['model']!=model or receipt['batch']!=6:
            raise ValueError('Wrong or incomplete inference')
        if receipt['modelSha256']!=lock['models'][model]['sha256']:raise ValueError('Inference model changed')
        scored[model]=score(manifest,receipt);receipts[model]=receipt;hashes[path.name]=sha(path)
    if timestamps!=sorted(timestamps) or len(set(timestamps))!=len(timestamps):raise ValueError('Frozen inference order changed')
    raw=lambda rows:{r['id']:r['rawText'] for r in rows}
    base='A1';candidate=lock['primaryCandidate']
    if raw(receipts[base]['rows'])!=raw(receipts['B0']['rows']):raise ValueError('Baseline conversion mismatch')
    exported=read(conversion/'receipt.json');gpu=read(run/'gpu-BN1/predictions.json')
    if exported['weightsSha256']!=sha(weights) or gpu['weightsSha256']!=sha(weights):raise ValueError('GPU weights changed')
    if exported['tarSha256']!=lock['models'][candidate]['sha256'] or not exported['dictionaryEqualToApp']:
        raise ValueError('Export or dictionary mismatch')
    score(manifest,gpu)
    if raw(gpu['rows'])!=raw(receipts[candidate]['rows']):raise ValueError('GPU/browser output mismatch')
    fields={r['id']:r['field'] for r in records};equipment={r['id']:r['equipmentGroup'] for r in records}
    models={}
    for model,result in scored.items():
        groups=defaultdict(list);items=defaultdict(list);by_field=defaultdict(list)
        for row in result['rows']:
            groups[row['source']].append(row['correct']);items[equipment[row['id']]].append(row['correct'])
            by_field[fields[row['id']]].append(row['correct'])
        models[model]={'metrics':result['groups']['test'],
            'allFiveNumericFields':{'exact':sum(all(v) for v in groups.values()),'total':len(groups)},
            'equipmentGroupsAllNumericViews':{'exact':sum(all(v) for v in items.values()),'total':len(items)},
            'byField':{k:{'exact':sum(v),'total':len(v)} for k,v in by_field.items()},
            'failures':[r for r in result['rows'] if not r['correct']]}
    baseline={r['id']:r for r in scored[base]['rows']};chosen=scored[candidate]['rows']
    changes={'improved':[r['id'] for r in chosen if r['correct'] and not baseline[r['id']]['correct']],
             'regressed':[r['id'] for r in chosen if not r['correct'] and baseline[r['id']]['correct']]}
    metric=models[candidate]['metrics']
    checks={'rawExactAtLeast99Percent':metric['exact']/metric['total']>=.99,
            'wrongNumericZero':metric['wrongNumeric']==0,'normalRegressionZero':not changes['regressed'],
            'improvedOverBothBaselines':metric['exact']>models[base]['metrics']['exact']}
    hashes.update({'test-manifest-lock.json':sha(run/'test-manifest-lock.json'),
        'gpu-BN1/predictions.json':sha(run/'gpu-BN1/predictions.json'),'audit-final.py':sha(Path(__file__))})
    return {'candidate':candidate,'models':models,'changes':changes,'recognizerGate':checks,
        'recognizerGatePassed':all(checks.values()),'baselineConversionEqual':True,'gpuBrowserEqual':True,
        'captureGroups':len({r['sourceGroupId'] for r in records}),
        'uncertainty':'One new capture session; correlated fields and repeated equipment. No across-session confidence interval can be estimated.',
        'productAdoption':'held; automatic localization and complete equipment/application checks are not passed by this numeric-only test',
        'sourceHashes':hashes,'limits':lock['limits']}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ('run','prior','conversion','weights'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--save',default='final-audit.json');args=parser.parse_args()
    if Path(args.save).name!=args.save:raise ValueError('Use an output filename')
    result=audit(args.run,args.prior,args.conversion,args.weights)
    with (args.run/args.save).open('x',encoding='utf-8') as file:json.dump(result,file,ensure_ascii=False,indent=2)
    print(json.dumps({'candidate':result['candidate'],'metrics':{k:v['metrics'] for k,v in result['models'].items()},
        'allFiveNumericFields':{k:v['allFiveNumericFields'] for k,v in result['models'].items()},
        'recognizerGate':result['recognizerGate'],'gpuBrowserEqual':result['gpuBrowserEqual']},ensure_ascii=True))

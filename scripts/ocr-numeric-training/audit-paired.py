"""Verify source separation, matched exposure, validation selection and exports."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from PIL import Image
from score import score


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(run,study):
    data=study/'data';manifest=read(data/'manifest.json');train=read(data/'training.json')['rows'];validation=read(data/'validation.json')['rows']
    sources={r['id']:r for r in train};truth={r['id']:r['label'] for r in validation}
    synthetic=read(run/'augmentation/synthetic.json')
    if synthetic['trainingListSha256']!=sha(data/'training.json'):raise ValueError('Training sources changed')
    if {r['sourceSha256'] for r in train}&{r['sourceSha256'] for r in validation}:raise ValueError('Source leakage')
    for row in synthetic['rows']:
        source=sources.get(row['sourceId'])
        if not source or row['sourceCropSha256']!=source['cropSha256'] or row['label']!=source['label']:raise ValueError('Invalid derivative provenance')
        path=run/'augmentation'/row['image']
        if sha(path)!=row['cropSha256']:raise ValueError('Synthetic image changed')
        t=row['transform'];left,right,top,bottom=t['padding'];w,h=t['resizedSize']
        with Image.open(path) as image:
            if list(image.size)!=t['outputSize'] or image.size!=(w+left+right,h+top+bottom):raise ValueError('Full source canvas was cropped')
    result={'sourceTrainingCount':len(train),'validationCount':len(validation),'syntheticCount':len(synthetic['rows']),
            'derivativesPerSource':sorted(set(Counter(r['sourceId'] for r in synthetic['rows']).values())),
            'newDigitShapes':False,'newIndependentSources':0,'digits':synthetic['digits'],'arms':{}}
    records={}
    for arm,model_id in [('control','C0'),('mixed','C1')]:
        config=read(run/arm/'config.json');receipt=read(run/arm/'receipt.json');history=read(run/arm/'history.json')
        if receipt['status']!='completed' or len(history)!=receipt['epochs']:raise ValueError('Training incomplete')
        if sha(run/arm/'paired-train.py')!=config['sourceCodeSha256'] or sha(run/arm/'pilot.py')!=config['pilotHelperSha256']:raise ValueError('Training code changed')
        best_epoch=None;best_exact=-1;no_improvement=0
        baseline_rows=read(run/arm/'baseline-validation.json')['rows']
        baseline_correct={r['id'] for r in baseline_rows if r['rawText']==truth[r['id']]}
        for row in history:
            predictions=read(run/arm/f"validation-{row['epoch']:02d}.json")['rows']
            correct={r['id'] for r in predictions if r['rawText']==truth[r['id']]}
            wrong=sum(r['rawText'].isascii() and r['rawText'].isdigit() and r['id'] not in correct for r in predictions)
            regressions=len(baseline_correct-correct)
            if row['validation']!={'total':len(validation),'exact':len(correct),'wrongNumeric':wrong,'normalRegressions':regressions}:
                raise ValueError('Validation metrics do not match raw output')
            eligible=len(correct)>len(baseline_correct) and wrong==0 and regressions==0
            improved=eligible and len(correct)>best_exact
            if improved:best_epoch=row['epoch'];best_exact=len(correct);no_improvement=0
            else:no_improvement+=1
            if row['selected']!=improved:raise ValueError('Checkpoint selection changed')
        if best_epoch!=receipt['bestEpoch'] or no_improvement<config['patience'] or receipt['stopReason']!='patience':raise ValueError('Early stopping differs')
        weights=run/arm/f'epoch-{best_epoch:02d}.pdparams'
        if sha(weights)!=receipt['selectedWeightsSha256']:raise ValueError('Selected model changed')
        gpu=read(run/f'eval-{arm}/predictions.json');scored=score(manifest,gpu)
        if gpu['weightsSha256']!=sha(weights):raise ValueError('Evaluation model changed')
        paths=list((run/'browser').glob(f'browser-{model_id}-b6-*.json'))
        if len(paths)!=1:raise ValueError('A unique browser receipt is required')
        browser=read(paths[0]);score(manifest,browser)
        if browser['modelSha256']!=sha(run/f'convert-{arm}/rec.tar'):raise ValueError('Browser model changed')
        equality={r['id']:r['rawText'] for r in gpu['rows']}=={r['id']:r['rawText'] for r in browser['rows']}
        if not equality:raise ValueError('GPU/browser output mismatch')
        result['arms'][arm]={'receipt':receipt,'scores':{k:{n:v[n] for n in ('total','exact','wrongNumeric')} for k,v in scored['groups'].items()},
            'gpuBrowserEqual':equality,'browserScores':{k:{n:v[n] for n in ('total','exact','wrongNumeric')} for k,v in score(manifest,browser)['groups'].items()},
            'failedIds':[r['id'] for r in scored['rows'] if not r['correct']]}
        records[arm]=receipt
    common=min(records['control']['epochs'],records['mixed']['epochs'])
    for epoch in range(1,common+1):
        a=read(run/'control'/f'epoch-{epoch:02d}-inputs.json');b=read(run/'mixed'/f'epoch-{epoch:02d}-inputs.json')
        if [(r['sourceId'],r['label']) for r in a]!=[(r['sourceId'],r['label']) for r in b]:raise ValueError('Source/label exposure differs')
    result['matchedExposureEpochs']=common;result['independentFinalTestCount']=manifest['independentTestCount']
    result['scope']='train-only appearance augmentation; no new digit shapes, independent test or product adoption'
    result['sourceCodeSha256']=sha(Path(__file__))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--run',type=Path,required=True);p.add_argument('--study',type=Path,required=True)
    p.add_argument('--save',default='paired-audit.json');args=p.parse_args()
    result=audit(args.run,args.study)
    if Path(args.save).name!=args.save:raise ValueError('Use an output filename')
    with (args.run/args.save).open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=True))

"""Score frozen automatic crops with extraction failures retained as failures."""
import argparse
import hashlib
import json
from pathlib import Path
from score import score


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser();p.add_argument('--run',type=Path,required=True);args=p.parse_args()
    manifest=read(args.run/'data/manifest.json')
    failures=manifest['automaticFailures'];all_rows=manifest['rows']+failures
    if len({r['id'] for r in all_rows})!=manifest['fullDenominator']:raise ValueError('Denominator changed')
    models=read(args.run/'browser-models.json');app=Path(__file__).resolve().parents[2]
    summary={'scope':'frozen prior OCR rows and automatic colon separation; not fresh whole-image detection',
             'fullDenominator':manifest['fullDenominator'],'extractionFailed':len(failures),'models':{}}
    for model in ('A1','BN1'):
        paths=list(args.run.glob(f'browser-{model}-b6-*.json'))
        if len(paths)!=1:raise ValueError('Select a unique immutable model receipt')
        receipt=read(paths[0])
        if receipt['modelSha256']!=sha(app/models[model]):raise ValueError('Model identity changed')
        scored=score(manifest,receipt)
        results={}
        for group,prefix in [('development','dev-'),('existingRegression','reg-')]:
            expected=[r for r in all_rows if r['id'].startswith(prefix)]
            outputs=[r for r in scored['rows'] if r['id'].startswith(prefix)]
            results[group]={'denominator':len(expected),'located':len(outputs),
                'exact':sum(r['correct'] for r in outputs),'extractionFailed':sum(r['id'].startswith(prefix) for r in failures),
                'wrongNumeric':sum(r['rawText'].isascii() and r['rawText'].lstrip('+').isdigit() and not r['correct'] for r in outputs),
                'failedRecognitionIds':[r['id'] for r in outputs if not r['correct']]}
        summary['models'][model]={'groups':results,'receiptSha256':sha(paths[0]),'rows':scored['rows']}
    before={r['id']:r for r in summary['models']['A1']['rows']}
    after=summary['models']['BN1']['rows']
    summary['changes']={'improved':[r['id'] for r in after if r['correct'] and not before[r['id']]['correct']],
                        'regressed':[r['id'] for r in after if not r['correct'] and before[r['id']]['correct']]}
    summary['unchangedFailures']=[{'id':r['id'],'reason':r['automaticFailure']} for r in failures]
    summary['sourceCodeSha256']=sha(Path(__file__))
    dest=args.run/'automatic-replay-score.json'
    with dest.open('x',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
    print(json.dumps({'fullDenominator':summary['fullDenominator'],'extractionFailed':len(failures),
        'models':{k:v['groups'] for k,v in summary['models'].items()},'changes':summary['changes']},ensure_ascii=False))


if __name__=='__main__':main()

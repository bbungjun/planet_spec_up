"""Audit stored pilot evidence without running OCR or training again."""
import argparse
import hashlib
import json
from pathlib import Path
from score import score


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(run):
    app=Path(__file__).resolve().parents[2]
    expanded=run/'additional-aran-20261011'
    data=expanded/'data';manifest=read(data/'manifest.json')
    for row in manifest['rows']:
        if sha(data/row['image'])!=row['cropSha256']:raise ValueError('Crop changed')
        if sha(app/row['source'])!=row['sourceSha256']:raise ValueError('Source changed')
    train_ids={r['id'] for r in manifest['rows'] if r['split']=='train'}
    validation_ids={r['id'] for r in manifest['rows'] if r['split']=='validation'}
    experiments={'B1':'pilot-real-38','BN1':'pilot-real-38-fixed-bn',
                 'BN2':'pilot-real-38-fixed-bn-seed2','BN3':'pilot-real-38-fixed-bn-seed3'}
    result={'scope':'small-data pilot; manually reviewed crops; no independent final test or product adoption',
            'manifestSha256':sha(data/'manifest.json'),'counts':manifest['counts'],'experiments':{}}
    def summary(receipt):
        scored=score(manifest,receipt)
        return {k:{n:v[n] for n in ('total','exact','wrongNumeric','emptyOrNonNumeric','nonzeroToZero','sources','sourceGroups')}
                for k,v in scored['groups'].items()}
    for name,folder in experiments.items():
        config=read(run/folder/'config.json');receipt=read(run/folder/'receipt.json')
        if set(config['sampleIds'])!=train_ids or set(config['sampleIds'])&validation_ids:
            raise ValueError('Training membership changed or leaked')
        if sha(run/folder/'training-source.py')!=config['sourceCodeSha256']:raise ValueError('Training code changed')
        prediction=read(expanded/f'paddle-{name}/predictions.json')
        if sha(run/folder/'epoch-20.pdparams')!=prediction['weightsSha256']:raise ValueError('Model identity changed')
        if receipt['status']!='completed' or receipt['steps']!=60:raise ValueError('Training incomplete')
        result['experiments'][name]={'scores':summary(prediction),'seed':config['seed'],
            'freezeBatchNorm':config.get('freezeBatchNorm',False),'receipt':receipt,
            'weightsSha256':prediction['weightsSha256']}
    base=read(expanded/'paddle-B0/predictions.json');result['baseline']=summary(base)
    def unique(pattern):
        paths=list(expanded.glob(pattern))
        if len(paths)!=1:raise ValueError('Select an explicit immutable receipt when repeating a browser run')
        return read(paths[0])
    def same(a,b):
        score(manifest,a);score(manifest,b)
        return {r['id']:r['rawText'] for r in a['rows']}=={r['id']:r['rawText'] for r in b['rows']}
    a1=unique('browser-A1-b6-*.json');b0=unique('browser-B0-b6-*.json')
    bn=read(expanded/'paddle-BN1/predictions.json')
    one=unique('browser-BN1-b1-*.json');six=unique('browser-BN1-b6-*.json')
    result['compatibility']={'A1_B0_Paddle_equal':same(a1,b0) and same(b0,base),
                             'BN1_Paddle_browser_batch1_batch6_equal':same(bn,one) and same(bn,six)}
    if not all(result['compatibility'].values()):raise ValueError('Selected model compatibility failed')
    if one['modelSha256']!=sha(run/'convert-BN1/rec.tar') or six['modelSha256']!=one['modelSha256']:
        raise ValueError('Browser model identity changed')
    result['checkpointLoad']=read(run/'exact-load-verification.json')
    result['exactContinuation']=read(run/'resume-deterministic-verification.json')['passed']
    result['independentTestCount']=manifest['independentTestCount']
    result['remaining']=['synthetic-data comparison','independent final test','automatic extraction and whole-equipment QA',
                         'actual Worker and cancellation/application checks','repeated browser timing and process-memory comparison']
    result['selectedResearchArtifact']={'path':'convert-BN1/rec.tar','sha256':six['modelSha256'],
        'selection':'first fixed-BN run; two other seeds only verify repeatability; no final-test selection'}
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--run',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();result=audit(args.run)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'counts':result['counts'],'compatibility':result['compatibility'],
                     'independentTestCount':result['independentTestCount'],'remaining':result['remaining']}))

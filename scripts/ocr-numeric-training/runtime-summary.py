"""Validate actual-worker receipts before aggregating timing and process memory."""
import argparse
import hashlib
import json
from pathlib import Path
from statistics import median
from score import score


def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def percentile(values,q):
    values=sorted(values)
    if not values:return None
    at=(len(values)-1)*q;lo=int(at);hi=min(lo+1,len(values)-1)
    return values[lo]+(values[hi]-values[lo])*(at-lo)
def distribution(values):
    return {'n':len(values),'min':min(values) if values else None,'p50':percentile(values,.5),
            'p95':percentile(values,.95),'max':max(values) if values else None}


def summarize(output,study,required):
    app=Path(__file__).resolve().parents[2]
    manifest=read(study/'data/manifest.json')
    inputs=read(study/'data/inputs.json')['rows']
    references={name:read(study/f'paddle-{ref}/predictions.json') for name,ref in [('A1','B0'),('BN1','BN1')]}
    models=read(study/'browser-models.json')
    rows=[]
    for trial_id in required:
        trial=read(output/f'runtime-{trial_id}.json');resources=read(output/f'resources-{trial_id}.json')
        if trial['id']!=trial_id or resources['id']!=trial_id:raise ValueError('Trial ID mismatch')
        if resources['definition'].split(',')!=[trial_id,trial['model'],str(trial['batch']),str(trial['rounds']),trial['mode']]:
            raise ValueError('Browser resource measurement belongs to another configuration')
        if trial['phase']!='complete' or trial.get('error') or trial['running'] or trial['liveWorkers']!=0:
            raise ValueError('Incomplete or failed Worker trial: '+trial_id)
        if resources['abortReason'] or not resources['samples']:raise ValueError('Missing/aborted resource measurement')
        if trial['inputHashes']!=[r['cropSha256'] for r in inputs]:raise ValueError('Inputs changed')
        if trial['modelSha256']!=sha(app/models[trial['model']]):raise ValueError('Model changed')
        provenance=read(output/trial['provenanceFile'])
        if provenance['inputManifestSha256']!=sha(study/'data/inputs.json'):raise ValueError('Input provenance changed')
        if provenance['modelHashes'][trial['model']]!=trial['modelSha256']:raise ValueError('Model provenance mismatch')
        reference={r['id']:r['rawText'] for r in references[trial['model']]['rows']}
        output_sets=trial['outputs'][:]
        if trial['mode'].startswith('cancel-'):
            if not trial.get('cancelled') or trial['outputsAtCancel'] or trial['outputsAfterGrace']:
                raise ValueError('Cancelled result accepted')
            cancel=next(e for e in trial['events'] if e['name']=='cancel-requested')
            expected_phase='initializing' if trial['mode']=='cancel-init' else 'recognizing'
            if cancel['actualPhase']!=expected_phase:raise ValueError('Wrong cancellation phase')
            output_sets.append(trial['restart'])
        elif len(output_sets)!=trial['rounds']:raise ValueError('Missing rounds')
        for output_set in output_sets:
            score(manifest,output_set)
            actual={r['id']:r['rawText'] for r in output_set['rows']}
            if actual!=reference:raise ValueError('Worker output differs from controlled reference: '+trial_id)
        initialization=trial.get('initialization') or trial['restartInitialization']
        for init in (initialization,trial.get('restartInitialization'),trial.get('residentInitialization')):
            if init and (init['globalScope']!='DedicatedWorkerGlobalScope' or init['provider']!='wasm'):
                raise ValueError('Actual WASM Worker not verified')
        samples=resources['samples'];ready=[s for s in samples if s['phase']=='ready']
        settled=[s for s in samples if s['phase']=='settling']
        if not ready:raise ValueError('No pre-worker memory baseline')
        baseline=median(s['privateBytes'] for s in ready)
        result={'id':trial_id,'model':trial['model'],'mode':trial['mode'],'batch':trial['batch'],
            'rounds':len(trial['outputs']),'inputCount':len(inputs),'outputMatchesReference':True,
            'scores':{k:{n:v[n] for n in ('total','exact','wrongNumeric')} for k,v in score(manifest,output_sets[-1])['groups'].items()},
            'initializeWallMs':initialization['wallMs'],'modelInitializeMs':initialization['initializeMs'],
            'decodeMs':initialization['decodeMs'],'roundsMs':[r['wallMs'] for r in trial['outputs']],
            'peakWorkingMiB':max(s['workingBytes'] for s in samples)/2**20,
            'peakPrivateMiB':max(s['privateBytes'] for s in samples)/2**20,
            'readyPrivateMiB':baseline/2**20,
            'peakPrivateDeltaMiB':(max(s['privateBytes'] for s in samples)-baseline)/2**20,
            'settledPrivateMiB':median(s['privateBytes'] for s in settled)/2**20 if settled else None,
            'resourceSamples':len(samples),'peakObservedWorkers':max((s.get('liveWorkers') or 0) for s in samples),
            'liveWorkersAtEnd':trial['liveWorkers'],'cancelLatencyMs':trial.get('cancelLatencyMs'),
            'heartbeatDelayMs':distribution(trial['heartbeatDelaysMs']),
            'receiptSha256':sha(output/f'runtime-{trial_id}.json'),'provenanceFile':trial['provenanceFile']}
        if trial['mode']=='dual':
            score(manifest,{'rows':trial['residentRows']})
            actual={r['id']:r['rawText'] for r in trial['residentRows']}
            if actual!={r['id']:r['rawText'] for r in references['A1']['rows']}:raise ValueError('Resident baseline differs')
            if result['peakObservedWorkers']!=2:raise ValueError('Additional resident model not measured')
        rows.append(result)
    groups={}
    for model in ('A1','BN1'):
        selected=[r for r in rows if r['model']==model and r['mode']=='normal' and r['batch']==6 and r['rounds']==6]
        groups[model]={
            'trials':len(selected),'coldWorkerReadyMs':distribution([r['initializeWallMs'] for r in selected]),
            'firstRecognitionMs':distribution([r['roundsMs'][0] for r in selected]),
            'warmRecognitionMs':distribution([v for r in selected for v in r['roundsMs'][1:]]),
            'peakPrivateMiB':distribution([r['peakPrivateMiB'] for r in selected]),
            'peakWorkingMiB':distribution([r['peakWorkingMiB'] for r in selected]),
            'settledPrivateMiB':distribution([r['settledPrivateMiB'] for r in selected if r['settledPrivateMiB'] is not None])}
    groups['dual']={'trials':sum(r['mode']=='dual' for r in rows),
        'peakPrivateMiB':distribution([r['peakPrivateMiB'] for r in rows if r['mode']=='dual']),
        'peakWorkingMiB':distribution([r['peakWorkingMiB'] for r in rows if r['mode']=='dual'])}
    ratios={key:groups['BN1'][key]['p50']/groups['A1'][key]['p50'] for key in
            ('coldWorkerReadyMs','firstRecognitionMs','warmRecognitionMs','peakPrivateMiB','peakWorkingMiB') if groups['A1'][key]['p50']}
    return {'scope':'local single-device numeric-crop Worker experiment; not full equipment/production proof',
            'recipe':'fresh browser/worker per trial; no-store model downloads; predecoded inputs; one first plus five warm reads; alternating model order',
            'memory':'sum of owned browser process Working Set / Private Bytes; shared pages may be counted repeatedly; 500 ms plus sampling overhead',
            'groups':groups,'BN1_over_A1_median_ratios':ratios,'trials':rows,
            'sourceCodeSha256':sha(Path(__file__)),
            'independentFinalTestCount':manifest['independentTestCount'],
            'remaining':['native product worker/adoption integration','whole equipment including automatic extraction','independent final test','real+synthetic training comparison']}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--study',type=Path,required=True)
    p.add_argument('--save',default='runtime-summary.json')
    p.add_argument('--require',nargs='+',required=True);args=p.parse_args()
    result=summarize(args.output,args.study,args.require)
    if Path(args.save).name!=args.save:raise ValueError('Summary must be a filename in the output directory')
    dest=args.output/args.save
    if dest.exists():raise ValueError('Do not overwrite a prior summary')
    dest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'groups':result['groups'],'ratios':result['BN1_over_A1_median_ratios']},ensure_ascii=False))

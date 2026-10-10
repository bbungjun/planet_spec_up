"""Strict, split-aware offline scoring. Labels never go to inference."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import unicodedata


def metrics(rows):
    correct=lambda r:r['rawText']==r['expected']
    numeric=lambda s:bool(re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]+)?%?',s))
    return {'total':len(rows),'exact':sum(correct(r) for r in rows),
      'formatOnlyExact':sum(unicodedata.normalize('NFKC',r['rawText']).strip()==r['expected'] for r in rows),
      'wrongNumeric':sum(numeric(r['rawText']) and not correct(r) for r in rows),
      'emptyOrNonNumeric':sum(not numeric(r['rawText']) for r in rows),
      'nonzeroToZero':sum(r['expected']!='0' and r['rawText']=='0' for r in rows),
      'digitOmission':sum(numeric(r['rawText']) and len(re.sub(r'\D','',r['rawText']))<len(re.sub(r'\D','',r['expected'])) for r in rows),
      'digitAddition':sum(numeric(r['rawText']) and len(re.sub(r'\D','',r['rawText']))>len(re.sub(r'\D','',r['expected'])) for r in rows)}


def score(manifest,receipt):
    if receipt.get('error') or receipt.get('running'):
        raise ValueError('Cannot score failed or incomplete inference')
    expected={r['id']:r for r in manifest['rows']}
    if len(expected)!=len(manifest['rows']):raise ValueError('Duplicate ground truth IDs')
    ids=[r['id'] for r in receipt['rows']]
    if Counter(ids)!=Counter(expected.keys()):raise ValueError('Missing/duplicate/unknown prediction IDs')
    input_manifest={'rows':[{k:r[k] for k in ('id','image','cropSha256')} for r in manifest['rows']]}
    input_hash=hashlib.sha256(json.dumps(input_manifest,indent=2).encode('utf-8')).hexdigest()
    rows=[]
    for pred in receipt['rows']:
        e=expected[pred['id']]
        if not isinstance(pred.get('rawText'),str):raise ValueError('Missing raw text')
        if 'inputSha256' in pred:
            if pred['inputSha256']!=e['cropSha256']:raise ValueError('Prediction input changed')
        elif receipt.get('inputSha256')!=input_hash:
            raise ValueError('Prediction lacks verified input identity')
        rows.append({**pred,'expected':e['label'],'split':e['split'],'group':e['sourceGroupId'],
                     'source':e['sourceSha256'],'correct':pred['rawText']==e['label']})
    groups={split:metrics([r for r in rows if r['split']==split]) for split in sorted({r['split'] for r in rows})}
    for split in groups:
        subset=[r for r in rows if r['split']==split]
        groups[split]['zeros']=metrics([r for r in subset if r['expected']=='0'])
        groups[split]['nonzeros']=metrics([r for r in subset if r['expected']!='0'])
        groups[split]['byDigits']={str(n):metrics([r for r in subset if len(re.sub(r'\D','',r['expected']))==n])
                                  for n in sorted({len(re.sub(r'\D','',r['expected'])) for r in subset})}
        groups[split]['sourceGroups']=len({r['group'] for r in subset})
        groups[split]['sources']=len({r['source'] for r in subset})
    return {'groups':groups,'rows':rows}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--receipt',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--baseline',type=Path);args=p.parse_args()
    read=lambda path:json.loads(path.read_text(encoding='utf-8'))
    manifest=read(args.manifest);result=score(manifest,read(args.receipt))
    if args.baseline:
        base={r['id']:r for r in score(manifest,read(args.baseline))['rows']}
        result['changes']={'improved':[r['id'] for r in result['rows'] if r['correct'] and not base[r['id']]['correct']],
                           'regressed':[r['id'] for r in result['rows'] if not r['correct'] and base[r['id']]['correct']],
                           'differentRaw':[r['id'] for r in result['rows'] if r['rawText']!=base[r['id']]['rawText']]}
    result['sourceHashes']={str(path.name):hashlib.sha256(path.read_bytes()).hexdigest() for path in (args.manifest,args.receipt,Path(__file__))}
    if args.baseline:result['baselineReceiptSha256']=hashlib.sha256(args.baseline.read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'groups':result['groups'],'changes':result.get('changes')},ensure_ascii=True))

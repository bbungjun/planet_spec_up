"""Compare uninterrupted and separately resumed model AND optimizer tensors."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--continuous',type=Path,required=True)
    p.add_argument('--resumed',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    import numpy as np
    import paddle
    paddle.set_device('cpu')
    def flatten(value,prefix=''):
        if isinstance(value,dict):
            return {k:v for key,item in value.items() for k,v in flatten(item,prefix+'/'+str(key)).items()}
        if isinstance(value,(list,tuple)):
            return {k:v for i,item in enumerate(value) for k,v in flatten(item,prefix+'/'+str(i)).items()}
        return {prefix:np.asarray(value)}
    report={}
    for suffix in ('.pdparams','.pdopt'):
        ap=args.continuous.with_suffix(suffix);bp=args.resumed.with_suffix(suffix)
        a=flatten(paddle.load(str(ap)));b=flatten(paddle.load(str(bp)))
        if a.keys()!=b.keys():raise ValueError('Checkpoint keys differ')
        differences=[]
        for key in a:
            if a[key].shape!=b[key].shape:raise ValueError('Checkpoint shape differs')
            if not np.array_equal(a[key],b[key]):
                differences.append({'key':key,'maxAbsoluteDifference':float(np.max(np.abs(a[key]-b[key]))),
                                    'withinTolerance':bool(np.allclose(a[key],b[key],rtol=1e-5,atol=1e-7))})
        report[suffix]={'tensorCount':len(a),'exactlyEqual':not differences,'differences':differences,
            'continuousSha256':hashlib.sha256(ap.read_bytes()).hexdigest(),
            'resumedSha256':hashlib.sha256(bp.read_bytes()).hexdigest()}
    report['passed']=all(r['exactlyEqual'] for r in report.values())
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:{j:v for j,v in value.items() if j!='differences'} if isinstance(value,dict) else value for k,value in report.items()}))
    if not report['passed']:raise SystemExit(1)


if __name__=='__main__':main()

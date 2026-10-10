"""Export a pinned upstream Paddle checkpoint and package it for the browser SDK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser()
    for key in ('upstream','weights','output','app-model'):p.add_argument('--'+key,type=Path,required=True)
    args=p.parse_args();args.upstream=args.upstream.resolve();args.weights=args.weights.resolve();args.output=args.output.resolve()
    if args.output.exists() and any(args.output.iterdir()):raise ValueError('Use a new conversion directory')
    args.output.mkdir(parents=True,exist_ok=True)
    env=os.environ.copy();env['FLAGS_enable_pir_api']='1'
    command=[sys.executable,'tools/export_model.py','-c','configs/rec/PP-OCRv5/multi_language/korean_PP-OCRv5_mobile_rec.yml','-o',
             'Global.pretrained_model='+str(args.weights),'Global.save_inference_dir='+str(args.output),'Global.use_gpu=False']
    with (args.output/'export.log').open('w') as log:
        subprocess.run(command,cwd=args.upstream,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    command=[str(Path(sys.executable).parent/'paddle2onnx'),'--model_dir',str(args.output),'--model_filename','inference.json',
             '--params_filename','inference.pdiparams','--save_file',str(args.output/'inference.onnx'),'--opset_version','14']
    with (args.output/'convert.log').open('w') as log:
        subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    import onnx
    import yaml
    onnx.checker.check_model(str(args.output/'inference.onnx'))
    with tarfile.open(args.app_model) as archive:
        original=yaml.safe_load(archive.extractfile(next(n for n in archive.getnames() if n.endswith('/inference.yml'))).read())
    config=yaml.safe_load((args.output/'inference.yml').read_text(encoding='utf-8'))
    if original['PostProcess']['character_dict']!=config['PostProcess']['character_dict']:
        raise ValueError('Character dictionary differs from the app')
    packaged=args.output/'rec.tar'
    with tarfile.open(packaged,'w') as archive:
        for name in ('inference.onnx','inference.yml'):
            archive.add(args.output/name,arcname='korean_PP-OCRv5_mobile_rec_onnx_infer/'+name)
    receipt={'status':'converted','upstreamCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.upstream,text=True).strip(),
             'weightsSha256':sha(args.weights),'onnxSha256':sha(args.output/'inference.onnx'),'tarSha256':sha(packaged),
             'configSha256':sha(args.output/'inference.yml'),'dictionaryEqualToApp':True,
             'onnxCheckerPassed':True,'browserVerified':False,'opset':14}
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt),flush=True)


if __name__=='__main__':main()

"""Local PP-OCRv5 pilot using upstream architecture, dictionary and CTC+NRTR loss.

This runner never selects a checkpoint using diagnostic or test labels. It writes
every epoch; the fixed final epoch is a learning-mechanics probe, not a champion.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import sys
import time

os.environ.setdefault('FLAGS_allocator_strategy', 'auto_growth')
os.environ.setdefault('FLAGS_cudnn_deterministic', '1')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def numeric_precision(paddle):
    return {'NVIDIA_TF32_OVERRIDE':os.environ.get('NVIDIA_TF32_OVERRIDE'),
            'flags':paddle.get_flags(['FLAGS_cudnn_deterministic','FLAGS_cudnn_exhaustive_search',
                                    'FLAGS_use_fast_math','FLAGS_enable_cublas_tensor_op_math'])}


def verify_resume_precision(metadata,current):
    if metadata.get('numericPrecision')!=current:
        raise ValueError('Resume numeric precision differs or was not recorded; use the original archived runner/settings')


def initialize(upstream, device):
    sys.path.insert(0,str(upstream.resolve()))
    import cv2
    import numpy as np
    import paddle
    import yaml
    from ppocr.modeling.architectures import build_model
    from ppocr.postprocess import build_post_process
    from ppocr.losses import build_loss
    from ppocr.data.imaug.label_ops import MultiLabelEncode
    cfg_path=upstream/'configs/rec/PP-OCRv5/multi_language/korean_PP-OCRv5_mobile_rec.yml'
    cfg=yaml.safe_load(cfg_path.read_text())
    dictionary=upstream/'ppocr/utils/dict/ppocrv5_korean_dict.txt'
    cfg['Global']['character_dict_path']=str(dictionary.resolve())
    decoder=build_post_process(cfg['PostProcess'], cfg['Global'])
    count=len(decoder.character)
    cfg['Architecture']['Head']['out_channels_list']={'CTCLabelDecode':count,'NRTRLabelDecode':count+3}
    paddle.set_device(device)
    def create():
        return build_model(copy.deepcopy(cfg['Architecture']))
    encoder=MultiLabelEncode(25,str(dictionary),True,gtc_encode='NRTRLabelEncode')
    return paddle,np,cv2,cfg,create,decoder,encoder,build_loss(copy.deepcopy(cfg['Loss']))


def images(data, rows, np, cv2):
    values=[]
    for row in rows:
        path=data/row['image']
        if digest(path)!=row['cropSha256']:
            raise ValueError('Input hash changed')
        im=cv2.imread(str(path)); h,w=im.shape[:2]
        rw=min(320, int(np.ceil(48*w/h)))
        resized=cv2.resize(im,(rw,48),interpolation=cv2.INTER_LINEAR)
        padded=np.zeros((3,48,320),np.float32)
        padded[:,:,:rw]=(resized.astype(np.float32).transpose(2,0,1)/255.-0.5)/0.5
        values.append(padded)
    return np.stack(values)


def evaluate(args):
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Use a new prediction directory; prior outputs must not be overwritten')
    paddle,np,cv2,cfg,create,decoder,_,_=initialize(args.upstream,args.device)
    inputs=json.loads((args.data/'inputs.json').read_text())['rows']
    batch=images(args.data,inputs,np,cv2)
    model=create(); state=paddle.load(str(args.weights))
    if set(state)!=set(model.state_dict()):
        raise ValueError('Weight key mismatch')
    model.set_state_dict(state); model.eval()
    result=[]; started=time.perf_counter()
    with paddle.no_grad():
        for i in range(0,len(inputs),6):
            preds=model(paddle.to_tensor(batch[i:i+6])).numpy()
            for row,(text,score) in zip(inputs[i:i+6],decoder(preds)):
                result.append({'id':row['id'],'rawText':text,'score':float(score),'inputSha256':row['cropSha256']})
    args.output.mkdir(parents=True,exist_ok=True)
    receipt={'weightsSha256':digest(args.weights),'inputSha256':digest(args.data/'inputs.json'),
             'device':args.device,'batch':6,'numericPrecision':numeric_precision(paddle),
             'sourceCodeSha256':digest(Path(__file__)),'durationSeconds':time.perf_counter()-started,'rows':result}
    (args.output/'predictions.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'rows':len(result),'seconds':receipt['durationSeconds']}))


def train(args):
    if args.epochs < 1 or args.batch < 1 or args.lr <= 0 or (args.limit is not None and args.limit < 1):
        raise ValueError('Positive epoch, batch, learning rate and sample limit required')
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Use a new output directory; do not overwrite prior runs')
    paddle,np,cv2,cfg,create,decoder,encoder,loss_fn=initialize(args.upstream,args.device)
    training=json.loads((args.data/'training.json').read_text(encoding='utf-8'))
    if training['sourceManifestSha256']!=digest(args.data/'manifest.json'):
        raise ValueError('Training list does not match the source manifest')
    rows=training['rows']
    if any(r['split']!='train' for r in rows):
        raise ValueError('Training list contains non-training rows')
    if not rows or args.epochs>20:
        raise ValueError('Pilot requires train-only rows and at most 20 epochs')
    if args.limit:
        rows=rows[:args.limit]
    seed=args.seed; random.seed(seed); np.random.seed(seed);paddle.seed(seed)
    x=images(args.data,rows,np,cv2)
    encoded=[encoder({'image':im,'label':r['label']}) for im,r in zip(x,rows)]
    if any(e is None for e in encoded):raise ValueError('Unencodable training label')
    arrays=[x,np.stack([e['label_ctc'] for e in encoded]),np.stack([e['label_gtc'] for e in encoded]),
            np.array([e['length'] for e in encoded],dtype='int64'),np.ones(len(rows),dtype='float32')]
    model=create(); state=paddle.load(str(args.weights))
    if set(state)!=set(model.state_dict()):raise ValueError('Weight key mismatch')
    if any(tuple(state[k].shape)!=tuple(v.shape) for k,v in model.state_dict().items()):raise ValueError('Weight shape mismatch')
    model.set_state_dict(state)
    optimizer=paddle.optimizer.Adam(learning_rate=args.lr,beta1=.9,beta2=.999,
        parameters=model.parameters(),weight_decay=paddle.regularizer.L2Decay(3e-5))
    start_epoch=0;step=0
    if args.resume:
        meta=json.loads(args.resume.with_suffix('.json').read_text())
        verify_resume_precision(meta,numeric_precision(paddle))
        if meta['manifestSha256']!=digest(args.data/'manifest.json') or meta['sampleIds']!=[r['id'] for r in rows]:
            raise ValueError('Resume dataset mismatch')
        for k in ('seed','batch','lr'):
            if meta[k]!=getattr(args,k):raise ValueError('Resume config mismatch: '+k)
        if meta.get('freezeBatchNorm',False)!=args.freeze_bn:
            raise ValueError('Resume BatchNorm policy mismatch')
        if meta['weightsSha256'] != digest(args.weights) or meta['dictionarySha256'] != digest(Path(cfg['Global']['character_dict_path'])):
            raise ValueError('Resume model or dictionary mismatch')
        if meta['sourceCodeSha256'] != digest(Path(__file__)):
            raise ValueError('Resume training code mismatch')
        model.set_state_dict(paddle.load(str(args.resume.with_suffix('.pdparams'))))
        optimizer.set_state_dict(paddle.load(str(args.resume.with_suffix('.pdopt'))))
        start_epoch=meta['epoch'];step=meta['step']
        if args.epochs <= start_epoch:
            raise ValueError('Resume must advance beyond the saved epoch')
        paddle.set_rng_state(paddle.load(str(args.resume.with_suffix('.rng'))))
    args.output.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(__file__,args.output/'training-source.py')
    fixed={'mode':'pilot-no-selection','epochs':args.epochs,'batch':args.batch,'lr':args.lr,'seed':seed,
           'sampleIds':[r['id'] for r in rows],'manifestSha256':digest(args.data/'manifest.json'),
           'weightsSha256':digest(args.weights),'dictionarySha256':digest(Path(cfg['Global']['character_dict_path'])),
           'sourceCodeSha256':digest(Path(__file__)),'trainCount':len(rows),'validationCount':0,'testCount':0,
           'runtimeFlags':paddle.get_flags(['FLAGS_cudnn_deterministic','FLAGS_cudnn_exhaustive_search']),
           'numericPrecision':numeric_precision(paddle),
           'freezeBatchNorm':args.freeze_bn,
           'normalization':'SDK BGR linear resize 48x<=320, zero normalized padding; original-color nearest3x',
           'augmentation':'none','loss':'upstream CTC + NRTR','selection':'fixed last epoch, no diagnostic selection'}
    (args.output/'config.json').write_text(json.dumps(fixed,indent=2))
    first_param=next(iter(model.parameters()));before=first_param.numpy().copy()
    started=time.perf_counter();events=[]
    def stage(name, epoch, step):
        print(json.dumps({'phase':name,'epoch':epoch,'step':step,
                          'elapsedSeconds':time.perf_counter()-started}),flush=True)
    for epoch in range(start_epoch,args.epochs):
        # Per-epoch seeds give the same next epoch after a process restart.
        paddle.seed(seed+epoch); order=np.random.default_rng(seed+epoch).permutation(len(rows))
        model.train()
        if args.freeze_bn:
            for layer in model.sublayers():
                if isinstance(layer,(paddle.nn.BatchNorm,paddle.nn.BatchNorm1D,paddle.nn.BatchNorm2D,paddle.nn.BatchNorm3D,paddle.nn.SyncBatchNorm)):
                    layer.eval()
        for offset in range(0,len(order),args.batch):
            indices=order[offset:offset+args.batch]
            batch=[paddle.to_tensor(a[indices]) for a in arrays]
            stage('forward',epoch+1,step+1)
            losses=loss_fn(model(batch[0],data=batch[1:]),batch)
            loss=losses['loss']; stage('backward',epoch+1,step+1);loss.backward()
            stage('gradient-check',epoch+1,step+1)
            grads=[p.grad for p in model.parameters() if p.grad is not None]
            grad_norm=float(paddle.sqrt(paddle.add_n([paddle.sum(g*g) for g in grads])).item())
            value=float(loss.item())
            if not np.isfinite(value) or not np.isfinite(grad_norm) or grad_norm==0:
                raise RuntimeError('Non-finite loss/gradient or zero gradient')
            optimizer.step();optimizer.clear_grad();step+=1
            event={'epoch':epoch+1,'step':step,'loss':value,'gradientNorm':grad_norm,
                   'elapsedSeconds':time.perf_counter()-started,
                   'gpuPeakAllocatedBytes':paddle.device.cuda.max_memory_allocated(),
                   'gpuPeakReservedBytes':paddle.device.cuda.max_memory_reserved()}
            events.append(event);print(json.dumps(event),flush=True)
            with (args.output/'steps.jsonl').open('a') as f:f.write(json.dumps(event)+'\n')
        prefix=args.output/f'epoch-{epoch+1:02d}'
        paddle.save(model.state_dict(),str(prefix.with_suffix('.pdparams')))
        paddle.save(optimizer.state_dict(),str(prefix.with_suffix('.pdopt')))
        paddle.save(paddle.get_rng_state(),str(prefix.with_suffix('.rng')))
        prefix.with_suffix('.json').write_text(json.dumps({**fixed,'epoch':epoch+1,'step':step},indent=2))
    result={'status':'completed','steps':step,'executedSteps':len(events),'startEpoch':start_epoch,
            'numericPrecision':fixed['numericPrecision'],
            'epoch':args.epochs,'firstLoss':events[0]['loss'],'lastLoss':events[-1]['loss'],
            'parameterDeltaMax':float(np.max(np.abs(first_param.numpy()-before))),
            'durationSeconds':time.perf_counter()-started,'resumeFrom':str(args.resume) if args.resume else None,
            'gpuPeakAllocatedBytes':paddle.device.cuda.max_memory_allocated(),
            'gpuPeakReservedBytes':paddle.device.cuda.max_memory_reserved()}
    (args.output/'receipt.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['train','evaluate'])
    for key in ('upstream','data','weights','output'):p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--device',default='gpu:0');p.add_argument('--epochs',type=int,default=20)
    p.add_argument('--batch',type=int,default=16);p.add_argument('--lr',type=float,default=3e-5)
    p.add_argument('--seed',type=int,default=20261010);p.add_argument('--limit',type=int)
    p.add_argument('--resume',type=Path)
    p.add_argument('--freeze-bn',action='store_true',help='Keep pretrained BatchNorm running statistics during small-data fine-tuning')
    a=p.parse_args();train(a) if a.mode=='train' else evaluate(a)

"""Matched real-replay vs train-derived augmentation, with validation-only selection.

Each epoch exposes every real source twice in both arms. The original 38-source
study therefore used 76 samples and 5 updates per epoch with batch size 16.
The mixed arm replaces the second occurrence by one derivative of that source.
Diagnostic/test labels are not loaded by this process.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import shutil
import time

from pilot import initialize,images,digest


def read(path):return json.loads(path.read_text(encoding='utf-8'))
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')


def main():
    p=argparse.ArgumentParser()
    for name in ('upstream','data','synthetic','weights','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--arm',choices=['real-replay','real-plus-augmentation'],required=True)
    p.add_argument('--epochs',type=int,default=20);p.add_argument('--patience',type=int,default=5)
    p.add_argument('--batch',type=int,default=16);p.add_argument('--lr',type=float,default=3e-5);p.add_argument('--seed',type=int,default=20261011)
    args=p.parse_args()
    if not 1<=args.epochs<=20 or args.patience<1 or args.batch<1 or args.lr<=0:raise ValueError('Invalid training limits')
    if args.output.exists() and any(args.output.iterdir()):raise ValueError('Use a new experiment directory')
    train_manifest=read(args.data/'training.json');validation_manifest=read(args.data/'validation.json')
    source_hash=digest(args.data/'manifest.json')
    if train_manifest['sourceManifestSha256']!=source_hash or validation_manifest['sourceManifestSha256']!=source_hash:
        raise ValueError('Split manifests changed')
    train=train_manifest['rows'];validation=validation_manifest['rows']
    if any(r['split']!='train' for r in train) or any(r['split']!='validation' for r in validation):raise ValueError('Wrong split')
    if not train or not validation:raise ValueError('Both train and validation are required')
    if {r['sourceGroupId'] for r in train}&{r['sourceGroupId'] for r in validation}:raise ValueError('Capture-session leakage')
    if {r['sourceSha256'] for r in train}&{r['sourceSha256'] for r in validation}:raise ValueError('Source leakage')
    synthetic=read(args.synthetic/'synthetic.json')
    if synthetic['trainingListSha256']!=digest(args.data/'training.json'):raise ValueError('Synthetic sources changed')
    by_source={r['id']:[] for r in train}
    for row in synthetic['rows']:
        if row['sourceId'] not in by_source or row['split']!='train':raise ValueError('Synthetic source is not train')
        original=next(r for r in train if r['id']==row['sourceId'])
        if row['label']!=original['label'] or row['sourceCropSha256']!=original['cropSha256']:raise ValueError('Synthetic label/source changed')
        by_source[row['sourceId']].append(row)
    if any(not v for v in by_source.values()):raise ValueError('Every source needs derivative coverage')
    paddle,np,cv2,cfg,create,decoder,encoder,loss_fn=initialize(args.upstream,'gpu:0')
    random.seed(args.seed);np.random.seed(args.seed);paddle.seed(args.seed)
    model=create();original=paddle.load(str(args.weights))
    if original.keys()!=model.state_dict().keys():raise ValueError('Weight keys changed')
    model.set_state_dict(original)
    optimizer=paddle.optimizer.Adam(learning_rate=args.lr,beta1=.9,beta2=.999,parameters=model.parameters(),
        weight_decay=paddle.regularizer.L2Decay(3e-5))
    real_x=images(args.data,train,np,cv2);val_x=images(args.data,validation,np,cv2)
    encoded=[encoder({'image':x,'label':r['label']}) for x,r in zip(real_x,train)]
    targets=[np.stack([e['label_ctc'] for e in encoded]),np.stack([e['label_gtc'] for e in encoded]),
             np.array([e['length'] for e in encoded],dtype='int64'),np.ones(len(train),dtype='float32')]
    targets=[np.concatenate([a,a]) for a in targets]
    def predict():
        model.eval();result=[]
        with paddle.no_grad():
            for offset in range(0,len(validation),6):
                raw=decoder(model(paddle.to_tensor(val_x[offset:offset+6])).numpy())
                result.extend({'id':row['id'],'rawText':text,'score':float(confidence),'inputSha256':row['cropSha256']}
                              for row,(text,confidence) in zip(validation[offset:offset+6],raw))
        return result
    expected={r['id']:r['label'] for r in validation}
    def metrics(rows,baseline=None):
        correct={r['id'] for r in rows if r['rawText']==expected[r['id']]}
        return {'total':len(rows),'exact':len(correct),
            'wrongNumeric':sum(r['rawText'].isascii() and r['rawText'].isdigit() and r['id'] not in correct for r in rows),
            'normalRegressions':len((baseline or set())-correct)},correct
    baseline_rows=predict();baseline,baseline_correct=metrics(baseline_rows)
    args.output.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(__file__,args.output/'paired-train.py');shutil.copyfile(Path(__file__).with_name('pilot.py'),args.output/'pilot.py')
    config={'arm':args.arm,'seed':args.seed,'lr':args.lr,'batch':args.batch,'maxEpochs':args.epochs,'patience':args.patience,
        'freezeBatchNorm':True,'realCount':len(train),'validationCount':len(validation),'testCount':0,
        'samplesPerEpoch':len(train)*2,'realToAugmentation':'1:1' if args.arm=='real-plus-augmentation' else 'real source replayed twice',
        'sourceManifestSha256':source_hash,'trainingSha256':digest(args.data/'training.json'),'validationSha256':digest(args.data/'validation.json'),
        'syntheticSha256':digest(args.synthetic/'synthetic.json'),'weightsSha256':digest(args.weights),
        'sourceCodeSha256':digest(Path(__file__)),'pilotHelperSha256':digest(Path(__file__).with_name('pilot.py')),
        'selection':'validation exact improvement over baseline; no increased wrong numeric or baseline-normal regressions; earliest tied epoch'}
    write(args.output/'config.json',config);write(args.output/'baseline-validation.json',{'metrics':baseline,'rows':baseline_rows})
    best=None;best_key=None;bad_epochs=0;step=0;history=[];seen_synthetic=set();start=time.perf_counter()
    for epoch in range(1,args.epochs+1):
        draw=random.Random(args.seed+epoch)
        chosen=[draw.choice(by_source[r['id']]) for r in train]
        augment_x=images(args.synthetic,chosen,np,cv2) if args.arm=='real-plus-augmentation' else real_x
        x=np.concatenate([real_x,augment_x]);arrays=[x]+targets
        order=np.random.default_rng(args.seed+epoch).permutation(len(x));paddle.seed(args.seed+epoch)
        layout=[{'sourceId':train[i%len(train)]['id'],'label':train[i%len(train)]['label'],
                 'imageId':train[i]['id'] if i<len(train) else chosen[i-len(train)]['id'] if args.arm=='real-plus-augmentation' else 'repeat-'+train[i-len(train)]['id']}
                 for i in order]
        write(args.output/f'epoch-{epoch:02d}-inputs.json',layout)
        if args.arm=='real-plus-augmentation':seen_synthetic.update(r['id'] for r in chosen)
        model.train()
        for layer in model.sublayers():
            if isinstance(layer,(paddle.nn.BatchNorm,paddle.nn.BatchNorm1D,paddle.nn.BatchNorm2D,paddle.nn.BatchNorm3D,paddle.nn.SyncBatchNorm)):layer.eval()
        losses=[]
        for pos in range(0,len(x),args.batch):
            indices=order[pos:pos+args.batch];batch=[paddle.to_tensor(a[indices]) for a in arrays]
            costs=loss_fn(model(batch[0],data=batch[1:]),batch);costs['loss'].backward()
            gradients=[p.grad for p in model.parameters() if p.grad is not None]
            norm=float(paddle.sqrt(paddle.add_n([paddle.sum(g*g) for g in gradients])).item());value=float(costs['loss'].item())
            if not np.isfinite(value) or not np.isfinite(norm) or norm==0:raise RuntimeError('Invalid loss or gradient')
            optimizer.step();optimizer.clear_grad();step+=1;losses.append(value)
            with (args.output/'steps.jsonl').open('a') as log:log.write(json.dumps({'epoch':epoch,'step':step,'loss':value,'gradientNorm':norm})+'\n')
        predicted=predict();quality,_=metrics(predicted,baseline_correct)
        eligible=quality['exact']>baseline['exact'] and quality['wrongNumeric']<=baseline['wrongNumeric'] and quality['normalRegressions']==0
        key=(quality['exact'],-quality['wrongNumeric'],-quality['normalRegressions'])
        selected=eligible and (best_key is None or key>best_key)
        prefix=args.output/f'epoch-{epoch:02d}'
        paddle.save(model.state_dict(),str(prefix.with_suffix('.pdparams')));paddle.save(optimizer.state_dict(),str(prefix.with_suffix('.pdopt')))
        paddle.save(paddle.get_rng_state(),str(prefix.with_suffix('.rng')))
        write(args.output/f'validation-{epoch:02d}.json',{'rows':predicted,'metrics':quality})
        if selected:best=epoch;best_key=key;bad_epochs=0
        else:bad_epochs+=1
        record={'epoch':epoch,'steps':step,'meanLoss':float(np.mean(losses)),'validation':quality,'eligible':eligible,'selected':selected,
                'bestEpoch':best,'epochsWithoutImprovement':bad_epochs,'elapsedSeconds':time.perf_counter()-start}
        history.append(record);print(json.dumps(record),flush=True);write(args.output/'history.json',history)
        if bad_epochs>=args.patience:break
    receipt={'status':'completed','arm':args.arm,'stopReason':'patience' if bad_epochs>=args.patience else 'max-epochs',
        'epochs':epoch,'steps':step,'bestEpoch':best,'baseline':baseline,'bestValidation':history[best-1]['validation'] if best else None,
        'uniqueAugmentationsUsed':len(seen_synthetic),'durationSeconds':time.perf_counter()-start,
        'gpuPeakAllocatedBytes':paddle.device.cuda.max_memory_allocated(),'gpuPeakReservedBytes':paddle.device.cuda.max_memory_reserved()}
    if best:receipt['selectedWeightsSha256']=digest(args.output/f'epoch-{best:02d}.pdparams')
    write(args.output/'receipt.json',receipt);print(json.dumps(receipt),flush=True)


if __name__=='__main__':main()

"""Replay captured SDK tensors to separate preprocessing and backend differences."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile

from pilot import initialize,images,digest


def read(path):return json.loads(path.read_text(encoding='utf-8'))


def main():
    parser=argparse.ArgumentParser()
    for name in ('run','data','upstream','weights','onnx','tar'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--save',default='tensor-comparison.json')
    args=parser.parse_args()
    if Path(args.save).name!=args.save:raise ValueError('Use an output filename')
    destination=args.run/args.save
    if destination.exists():raise ValueError('Do not overwrite comparisons')
    protocol=read(args.run/'protocol.json');inputs=read(args.data/'inputs.json')['rows']
    if digest(args.data/'inputs.json')!=protocol['inputsHash'] or digest(args.tar)!=protocol['modelHash']:
        raise ValueError('Capture input/model changed')
    with tarfile.open(args.tar) as archive:
        members=[m for m in archive.getmembers() if m.name.endswith('.onnx')]
        if len(members)!=1 or hashlib.sha256(archive.extractfile(members[0]).read()).hexdigest()!=digest(args.onnx):
            raise ValueError('ONNX file differs from captured browser model')
    paddle,np,cv2,cfg,create,decoder,_,_=initialize(args.upstream,'cpu')
    import onnxruntime as ort
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    session=ort.InferenceSession(str(args.onnx),sess_options=options,providers=['CPUExecutionProvider'])
    weights=paddle.load(str(args.weights));model=create();model.set_state_dict(weights);model.eval()
    original=images(args.data,inputs,np,cv2)
    variants={}
    for name,rgba in [('native-bgr-js-normalize',False),('native-rgba-js-normalize',True)]:
        result=[]
        for row in inputs:
            im=cv2.imread(str(args.data/row['image']));h,w=im.shape[:2];rw=min(320,int(np.ceil(48*w/h)))
            if rgba:im=cv2.cvtColor(im,cv2.COLOR_BGR2RGBA)
            im=cv2.resize(im,(rw,48),interpolation=cv2.INTER_LINEAR)
            if rgba:im=cv2.cvtColor(im,cv2.COLOR_RGBA2BGR)
            padded=np.zeros((3,48,320),np.float32)
            padded[:,:,:rw]=((im.astype(np.float64).transpose(2,0,1)*(1/255)-.5)/.5).astype(np.float32)
            result.append(padded)
        variants[name]=np.stack(result)
    batches=[]
    paths=sorted(args.run.glob('batch-*.json'),key=lambda p:int(p.stem.split('-')[1]))
    if not paths:raise ValueError('No captured tensors')
    def delta(a,b):
        difference=np.abs(a-b)
        return {'different':int(np.count_nonzero(difference)),'maxAbs':float(np.max(difference)),
                'meanAbs':float(np.mean(difference)),'argmaxTimestepsDifferent':int(np.sum(np.argmax(a,axis=-1)!=np.argmax(b,axis=-1)))}
    for path in paths:
        meta=read(path);prefix=args.run/path.stem
        x=np.fromfile(str(prefix)+'-input.f32',dtype='<f4').reshape(meta['inputDims'])
        browser=np.fromfile(str(prefix)+'-output.f32',dtype='<f4').reshape(meta['outputDims'])
        if meta['ids']!=[inputs[i]['id'] for i in meta['indices']]:raise ValueError('Captured batch order changed')
        reference=original[meta['indices']]
        item={'ids':meta['ids'],'inputDims':list(x.shape),'outputDims':list(browser.shape),'inputVariants':{},'outputs':{}}
        for name,a in [('python-original',reference)]+[(k,v[meta['indices']]) for k,v in variants.items()]:
            item['inputVariants'][name]={'differentFloats':int(np.count_nonzero(a!=x)),'maxAbs':float(np.max(np.abs(a-x))),
                'roundedPixelDifferences':int(np.count_nonzero(np.rint((a+1)*127.5)!=np.rint((x+1)*127.5)))}
        item['outputs']['browser']={'texts':[v[0] for v in decoder(browser)],'scores':[float(v[1]) for v in decoder(browser)]}
        for name,a in [('python-original',reference),('browser-captured',x)]:
            with paddle.no_grad():predicted=model(paddle.to_tensor(a)).numpy()
            onnx=session.run(None,{session.get_inputs()[0].name:a})[0]
            for backend,array in [('paddle-cpu',predicted),('onnx-cpu',onnx)]:
                item['outputs'][backend+'-'+name]={'texts':[v[0] for v in decoder(array)],'deltaVsBrowser':delta(array,browser)}
        batches.append((item,x,reference,browser))
    paddle.set_device('gpu:0');gpu=create();gpu.set_state_dict(paddle.load(str(args.weights)));gpu.eval()
    for item,x,reference,browser in batches:
        for name,a in [('python-original',reference),('browser-captured',x)]:
            with paddle.no_grad():array=gpu(paddle.to_tensor(a)).numpy()
            item['outputs']['paddle-gpu-'+name]={'texts':[v[0] for v in decoder(array)],'deltaVsBrowser':delta(array,browser)}
    result={'scope':'Diagnostic replay of two mismatching batches, not new training or accuracy selection.',
        'NVIDIA_TF32_OVERRIDE':os.environ.get('NVIDIA_TF32_OVERRIDE'),
        'paddleFlags':paddle.get_flags(['FLAGS_cudnn_deterministic','FLAGS_use_fast_math','FLAGS_enable_cublas_tensor_op_math']),
        'versions':{'paddle':paddle.__version__,'nativeOpenCV':cv2.__version__,'onnxruntime':ort.__version__},
        'sourceHashes':{'weights':digest(args.weights),'onnx':digest(args.onnx),'protocol':digest(args.run/'protocol.json'),'script':digest(Path(__file__))},
        'batches':[item for item,*_ in batches]}
    with destination.open('x',encoding='utf-8') as file:json.dump(result,file,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=True),flush=True)


if __name__=='__main__':main()

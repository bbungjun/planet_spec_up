"""Appearance-only derivatives of complete train crops; no new font/number claims.

All original pixels remain inside the canvas. No crop, occlusion, erasure, digit
replacement or validation/test image is used. Labels are unchanged source labels.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random
from PIL import Image,ImageDraw,ImageFilter
import numpy as np


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))


def synthesize(data,output,count,seed):
    app=Path(__file__).resolve().parents[2];output=output.resolve()
    if not output.is_relative_to(app/'output'):raise ValueError('Private output must be under output/')
    if output.exists() and any(output.iterdir()):raise ValueError('Use a new synthesis directory')
    training=read(data/'training.json');rows=training['rows']
    if training['sourceManifestSha256']!=sha(data/'manifest.json'):raise ValueError('Training manifest changed')
    if not rows or any(r['split']!='train' or r['completeness']!='complete' for r in rows):raise ValueError('Only complete training crops allowed')
    if count<1:raise ValueError('Count must be positive')
    sources=[]
    for row in rows:
        source=data/row['image']
        if sha(source)!=row['cropSha256']:raise ValueError('Source crop changed')
        with Image.open(source) as image:sources.append(image.convert('RGB'))
    (output/'crops').mkdir(parents=True)
    rng=random.Random(seed);generated=[]
    order=list(range(len(rows)));rng.shuffle(order)
    for index in range(count):
        source_index=order[index%len(rows)];source=rows[source_index];image=sources[source_index]
        scale=rng.uniform(.9,1.15)
        width=max(1,round(image.width*scale));height=max(1,round(image.height*scale))
        sampling=rng.choice(['nearest','bilinear'])
        resized=image.resize((width,height),Image.Resampling.NEAREST if sampling=='nearest' else Image.Resampling.BILINEAR)
        # Positive monotone tone changes and very weak blur preserve all glyphs.
        gain=rng.uniform(.92,1.08);offset=rng.uniform(-8,8);blur=rng.choice([0,0,.15,.25])
        pixels=np.clip(np.asarray(resized,dtype=np.float32)*gain+offset,0,255).astype('uint8')
        resized=Image.fromarray(pixels)
        if blur:resized=resized.filter(ImageFilter.GaussianBlur(blur))
        left,right,top,bottom=[rng.randrange(0,7) for _ in range(4)]
        edges=np.concatenate([pixels[0],pixels[-1],pixels[:,0],pixels[:,-1]],axis=0)
        background=tuple(int(v) for v in np.median(edges,axis=0))
        canvas=Image.new('RGB',(width+left+right,height+top+bottom),background)
        canvas.paste(resized,(left,top))
        filename=f'aug-{index:04d}.png';destination=output/'crops'/filename;canvas.save(destination)
        generated.append({'id':f'aug-{index:04d}','split':'train','kind':'appearance-augmentation',
            'sourceId':source['id'],'sourceGroupId':source['sourceGroupId'],'sourceCropSha256':source['cropSha256'],
            'label':source['label'],'image':'crops/'+filename,'cropSha256':sha(destination),
            'transform':{'scale':scale,'sampling':sampling,'gain':gain,'offset':offset,'blur':blur,
                         'padding':[left,right,top,bottom],'sourceSize':[image.width,image.height],
                         'resizedSize':[width,height],'outputSize':[canvas.width,canvas.height]}})
    manifest={'mode':'train-only appearance derivatives','seed':seed,'count':count,
        'trainingListSha256':sha(data/'training.json'),'sourceCodeSha256':sha(Path(__file__)),
        'sourceCount':len(rows),'labelCounts':dict(Counter(r['label'] for r in generated)),
        'digits':sorted(set(''.join(r['label'] for r in generated))),
        'newDigitShapes':False,'newIndependentSources':0,'rows':generated}
    (output/'synthetic.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    # Deterministic preview for visual review; it is not an OCR-based filter.
    preview=Image.new('RGB',(1200,10*95),'#eeeeee');draw=ImageDraw.Draw(preview)
    chosen=[generated[i] for i in np.linspace(0,count-1,40,dtype=int)]
    for i,row in enumerate(chosen):
        x=i%4*300;y=i//4*95;draw.text((x+4,y+3),row['id']+' = '+row['label'],fill='black')
        with Image.open(output/row['image']) as image:
            image.thumbnail((290,70));preview.paste(image,(x+4,y+20))
    preview.save(output/'preview.png')
    print(json.dumps({k:v for k,v in manifest.items() if k!='rows'},ensure_ascii=True))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--count',type=int,default=3040);p.add_argument('--seed',type=int,default=20261011)
    args=p.parse_args();synthesize(args.data,args.output,args.count,args.seed)

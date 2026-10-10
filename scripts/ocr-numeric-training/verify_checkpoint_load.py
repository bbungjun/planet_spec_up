"""Prove model tensors and Adam's deferred accumulators survive checkpoint load."""
import argparse
import json
from pathlib import Path
from pilot import initialize,digest


def main():
    p=argparse.ArgumentParser()
    for key in ('upstream','checkpoint','output'):p.add_argument('--'+key,type=Path,required=True)
    args=p.parse_args()
    paddle,np,_,_,create,_,_,_=initialize(args.upstream,'cpu')
    model=create()
    state=paddle.load(str(args.checkpoint.with_suffix('.pdparams')))
    model.set_state_dict(state)
    restored=model.state_dict()
    if restored.keys()!=state.keys():raise ValueError('Model keys changed')
    if not all(np.array_equal(state[k].numpy(),restored[k].numpy()) for k in state):
        raise ValueError('Model tensors changed on load')
    meta=json.loads(args.checkpoint.with_suffix('.json').read_text())
    optimizer=paddle.optimizer.Adam(learning_rate=meta['lr'],beta1=.9,beta2=.999,
        parameters=model.parameters(),weight_decay=paddle.regularizer.L2Decay(3e-5))
    opt=paddle.load(str(args.checkpoint.with_suffix('.pdopt')))
    optimizer.set_state_dict(opt)
    # Paddle 3.2.2 keeps restored tensors here until accumulators initialize at step().
    held=optimizer._accumulators_holder
    if held.keys()!=opt.keys():raise ValueError('Adam keys changed')
    if not all(np.array_equal(np.asarray(opt[k]),np.asarray(held[k])) for k in opt):
        raise ValueError('Adam accumulators changed on load')
    receipt={'modelTensorCount':len(state),'adamTensorCount':len(opt),'modelExact':True,'adamExact':True,
        'paddleVersion':paddle.__version__,'checkpointSha256':digest(args.checkpoint.with_suffix('.pdparams')),
        'optimizerSha256':digest(args.checkpoint.with_suffix('.pdopt')),
        'scope':'Exact restored state before the next step; subsequent GPU embedding reductions may differ numerically.'}
    args.output.write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))


if __name__=='__main__':main()

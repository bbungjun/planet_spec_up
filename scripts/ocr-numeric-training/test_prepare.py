import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from prepare import prepare,sha


class DatasetIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.app=Path(__file__).resolve().parents[2]
        self.temp=tempfile.TemporaryDirectory(dir=self.app/'output',prefix='numeric-training-test-')
        self.root=Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(self.app/'output'))
        self.source=self.root/'source.png';Image.new('RGB',(40,20),'white').save(self.source)
        self.row={'id':'one','source':self.source.relative_to(self.app).as_posix(),'sourceGroupId':'one-session',
                  'split':'train','label':'10','crop':[3,2,20,16],'completeness':'complete','reviews':['first','second']}
        self.output=self.root/'prepared';self.review=self.root/'review.json'

    def tearDown(self):self.temp.cleanup()

    def run_prepare(self,rows):
        self.review.write_text(json.dumps({'rows':rows}),encoding='utf-8')
        prepare(self.review,self.output)

    def test_group_leak_is_rejected_before_crops_are_written(self):
        with self.assertRaises(ValueError):self.run_prepare([self.row,{**self.row,'id':'two','split':'validation'}])
        self.assertFalse((self.output/'crops').exists())

    def test_incomplete_or_unreviewed_crops_are_rejected(self):
        for change in ({'completeness':'truncated'},{'reviews':['first']}):
            with self.assertRaises(ValueError):self.run_prepare([{**self.row,**change}])

    def test_prior_inputs_are_preserved_and_inference_has_no_labels(self):
        self.run_prepare([self.row]);crop=self.output/'crops/one.png';before=sha(crop)
        with Image.open(crop) as image:self.assertEqual(image.size,(60,48))
        inputs=json.loads((self.output/'inputs.json').read_text())
        self.assertEqual(set(inputs['rows'][0]),{'id','image','cropSha256'})
        with self.assertRaises(ValueError):self.run_prepare([{**self.row,'crop':[4,2,20,16]}])
        self.assertEqual(sha(crop),before)

    def test_path_escape_is_rejected(self):
        with self.assertRaises(ValueError):self.run_prepare([{**self.row,'id':'../escape'}])

    def test_learner_receives_only_training_labels(self):
        self.run_prepare([self.row,{**self.row,'id':'review-only','split':'diagnostic','label':'80'}])
        training=json.loads((self.output/'training.json').read_text(encoding='utf-8'))
        self.assertEqual([r['id'] for r in training['rows']],['one'])
        self.assertEqual(training['sourceManifestSha256'],sha(self.output/'manifest.json'))


if __name__=='__main__':unittest.main()

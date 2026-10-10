import copy
import hashlib
import json
import unittest

from score import score


class ScoringBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.manifest={'rows':[
            {'id':'a','label':'10','split':'train','cropSha256':'crop-a','sourceSha256':'source-a','sourceGroupId':'session-a'},
            {'id':'b','label':'80','split':'diagnostic','cropSha256':'crop-b','sourceSha256':'source-b','sourceGroupId':'session-b'},
            {'id':'c','label':'0','split':'diagnostic','cropSha256':'crop-c','sourceSha256':'source-b','sourceGroupId':'session-b'}]}
        for r in self.manifest['rows']:r['image']='crops/'+r['id']+'.png'
        inputs={'rows':[{k:r[k] for k in ('id','image','cropSha256')} for r in self.manifest['rows']]}
        self.input_hash=hashlib.sha256(json.dumps(inputs,indent=2).encode()).hexdigest()

    def score(self,receipt):
        return score(self.manifest,{'inputSha256':self.input_hash,**receipt})

    def test_wrong_zero_and_character_confusion_remain_failures(self):
        result=self.score({'rows':[{'id':'a','rawText':'10'},{'id':'b','rawText':'0'},{'id':'c','rawText':'O'}]})
        self.assertEqual(result['groups']['train']['exact'],1)
        self.assertEqual(result['groups']['diagnostic']['exact'],0)
        self.assertEqual(result['groups']['diagnostic']['nonzeroToZero'],1)
        self.assertEqual(result['groups']['diagnostic']['wrongNumeric'],1)
        self.assertEqual(result['groups']['diagnostic']['emptyOrNonNumeric'],1)
        self.assertEqual(result['groups']['diagnostic']['sourceGroups'],1)

    def test_missing_and_duplicate_predictions_are_not_dropped(self):
        for rows in [[{'id':'a','rawText':'10'}],
                     [{'id':'a','rawText':'10'},{'id':'a','rawText':'10'},{'id':'c','rawText':'0'}]]:
            with self.assertRaises(ValueError):self.score({'rows':rows})

    def test_changed_input_and_failed_run_cannot_score(self):
        receipt={'rows':[{'id':'a','rawText':'10'},{'id':'b','rawText':'80'},{'id':'c','rawText':'0'}]}
        bad=copy.deepcopy(receipt);bad['rows'][0]['inputSha256']='changed'
        with self.assertRaises(ValueError):self.score(bad)
        with self.assertRaises(ValueError):self.score({**receipt,'error':'runtime failure'})
        with self.assertRaises(ValueError):score(self.manifest,receipt)

    def test_format_cleanup_never_changes_strict_score(self):
        result=self.score({'rows':[{'id':'a','rawText':'１０'},{'id':'b','rawText':'80 '},{'id':'c','rawText':'0'}]})
        self.assertEqual(result['groups']['train']['exact'],0)
        self.assertEqual(result['groups']['train']['formatOnlyExact'],1)
        self.assertEqual(result['groups']['diagnostic']['exact'],1)
        self.assertEqual(result['groups']['diagnostic']['formatOnlyExact'],2)


if __name__=='__main__':unittest.main()

import unittest
from pilot import verify_resume_precision


class ResumePrecisionTest(unittest.TestCase):
    def test_identical_recorded_precision_is_accepted(self):
        precision={'NVIDIA_TF32_OVERRIDE':'0','flags':{'FLAGS_cudnn_deterministic':True}}
        verify_resume_precision({'numericPrecision':precision},precision)

    def test_switching_tf32_or_kernel_policy_is_rejected(self):
        precision={'NVIDIA_TF32_OVERRIDE':'0','flags':{'FLAGS_cudnn_deterministic':True}}
        for changed in ({**precision,'NVIDIA_TF32_OVERRIDE':None},
                        {**precision,'flags':{'FLAGS_cudnn_deterministic':False}}):
            with self.assertRaises(ValueError):verify_resume_precision({'numericPrecision':precision},changed)

    def test_unrecorded_legacy_precision_is_not_silently_assumed(self):
        with self.assertRaises(ValueError):verify_resume_precision({}, {'NVIDIA_TF32_OVERRIDE':'0','flags':{}})


if __name__=='__main__':unittest.main()

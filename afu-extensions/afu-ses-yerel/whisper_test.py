import unittest
import contextlib
import io
import json
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import yaziya_dok as whisper


class WhisperTests(unittest.TestCase):
    def test_hallucinations_are_removed_but_real_sentences_survive(self):
        cases = [
            ('Abone olmayı unutmayın. Beğenmeyi unutmayın!', ''),
            ('İzlediğiniz için teşekkür ederim. Altyazı M.K.', ''),
            ('Kanalıma abone olmayı unutmayın', ''),
            ('Yorum yapmayı unutmayın.', ''),
            ('Merhaba, ben Afu. Abone olmayı unutmayın. Yarın görüşürüz.',
             'Merhaba, ben Afu. Yarın görüşürüz.'),
            ('Altyazı dosyasını açar mısın?', 'Altyazı dosyasını açar mısın?'),
            ('Bu kanalı beğeniyorum.', 'Bu kanalı beğeniyorum.'),
            ('Abone ol düğmesi çalışmıyor.', 'Abone ol düğmesi çalışmıyor.'),
            ('', ''),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(whisper.halusinasyon_suz(text), expected)

    def test_high_no_speech_segments_do_not_leak_into_transcript(self):
        class Model:
            def transcribe(self, audio, **kwargs):
                return iter([
                    SimpleNamespace(text='Hayalet sözler', no_speech_prob=0.61),
                    SimpleNamespace(text='Merhaba Afu.', no_speech_prob=0.1),
                    SimpleNamespace(text='Abone olmayı unutmayın.', no_speech_prob=0.2),
                ]), None
        self.assertEqual(whisper.yaziya_dok(Model(), 'unused.wav'), 'Merhaba Afu.')

    def test_server_preserves_ids_and_continues_after_invalid_file(self):
        class Model:
            def transcribe(self, audio):
                return 'Merhaba Afu.'
        with tempfile.NamedTemporaryFile() as audio:
            requests = '\n'.join(json.dumps(req) for req in [
                {'id': 'bad', 'dosya': audio.name + '.missing'},
                {'id': 'second', 'dosya': audio.name},
                {'id': 'first', 'dosya': audio.name},
            ])
            output = io.StringIO()
            with patch.object(sys, 'stdin', io.StringIO(requests)), contextlib.redirect_stdout(output):
                self.assertEqual(whisper.serve(Model()), 0)
            replies = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(replies[0], {'id': None, 'metin': ''})
            self.assertEqual(replies[1]['id'], 'bad')
            self.assertIn('hata', replies[1])
            self.assertEqual(replies[2:], [
                {'id': 'second', 'metin': 'Merhaba Afu.'},
                {'id': 'first', 'metin': 'Merhaba Afu.'},
            ])

    def test_cuda_runtime_failure_recovers_on_cpu_and_reuses_fallback(self):
        loaded = []

        class Model:
            def __init__(self, device):
                self.device = device
                self.calls = 0

            def transcribe(self, audio, **kwargs):
                self.calls += 1
                if self.device == 'cuda' and self.calls > 1:
                    raise RuntimeError('CUDA inference failed')
                return iter([SimpleNamespace(text='Merhaba Afu.', no_speech_prob=0.0)]), None

        def load(instance, name, device, compute_type):
            loaded.append((device, compute_type))
            return Model(device)

        with patch.dict(sys.modules, {'ctranslate2': SimpleNamespace(get_cuda_device_count=lambda: 1)}), \
                patch.object(whisper.Whisper, 'load', load):
            runtime = whisper.Whisper('unused')
            self.assertEqual(runtime.transcribe('unused.wav'), 'Merhaba Afu.')
            self.assertEqual(runtime.transcribe('unused.wav'), 'Merhaba Afu.')
        self.assertEqual(loaded, [('cuda', 'float16'), ('cpu', 'int8')])

    def test_no_cuda_uses_cpu_without_attempting_gpu_load(self):
        def load(instance, name, device, compute_type):
            if name != 'small' or device != 'cpu' or compute_type != 'int8':
                raise RuntimeError('Unsupported device')
            return SimpleNamespace(transcribe=lambda *args, **kwargs: (iter([]), None))

        with patch.dict(sys.modules, {'ctranslate2': SimpleNamespace(get_cuda_device_count=lambda: 0)}), \
                patch.object(whisper.Whisper, 'load', load), contextlib.redirect_stderr(io.StringIO()):
            runtime = whisper.Whisper('unused')
            self.assertEqual(runtime.transcribe('unused.wav'), '')


if __name__ == '__main__':
    unittest.main()

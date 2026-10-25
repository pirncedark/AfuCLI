import asyncio
import tempfile
import unittest
import sys
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import tts


class TtsTests(unittest.IsolatedAsyncioTestCase):
    def test_piper_reuses_loaded_voice_and_writes_playable_pcm(self):
        voice = Mock()
        def write_audio(text, output):
            output.setparams((1, 2, 22050, 0, "NONE", "not compressed"))
            output.writeframes(b"\x00\x00" * len(text))
        voice.synthesize_wav.side_effect = write_audio
        factory = Mock()
        factory.load.return_value = voice
        tts.VOICES.clear()
        try:
            with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {"piper.voice": SimpleNamespace(PiperVoice=factory)}):
                for index, text in enumerate(["Merhaba", "İkinci"]):
                    filename = str(Path(directory) / f"ses{index}.wav")
                    tts.piper(text, "model.onnx", filename)
                    with tts.wave.open(filename, "rb") as audio:
                        self.assertEqual(audio.getnframes(), len(text))
                        self.assertEqual(audio.getframerate(), 22050)
            factory.load.assert_called_once_with("model.onnx")
        finally:
            tts.VOICES.clear()

    async def test_slow_edge_is_cancelled_before_piper_starts(self):
        cancelled = []
        async def slow_edge(*args):
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.append(True)
        with tempfile.TemporaryDirectory() as directory:
            base = str(Path(directory) / "ses")
            def piper(text, model, filename):
                self.assertEqual(cancelled, [True])
                Path(filename).write_bytes(b"RIFF")
            with patch.object(tts, "EDGE_TIMEOUT", 0.01), patch.object(tts, "edge", side_effect=slow_edge), patch.object(tts, "piper", side_effect=piper):
                result = await tts.synthesize("Merhaba", "voice", "model", base)
            self.assertEqual(Path(result).read_bytes(), b"RIFF")

    async def test_edge_failure_and_timeout_fall_back_to_warm_piper(self):
        for error in (OSError("offline"), asyncio.TimeoutError()):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as directory:
                base = str(Path(directory) / "ses")
                def piper(text, model, filename):
                    Path(filename).write_bytes(b"RIFF-fake-pcm")
                with patch.object(tts, "edge", new=AsyncMock(side_effect=error)), patch.object(tts, "piper", side_effect=piper) as fallback:
                    result = await tts.synthesize("Merhaba", "voice", "model", base)
                self.assertEqual(Path(result).read_bytes(), b"RIFF-fake-pcm")
                self.assertEqual(Path(result).suffix, ".wav")
                fallback.assert_called_once_with("Merhaba", "model", base + ".wav")
                self.assertFalse(Path(base + ".mp3").exists())

    async def test_edge_success_never_loads_piper(self):
        with tempfile.TemporaryDirectory() as directory:
            base = str(Path(directory) / "ses")
            async def edge(text, voice, filename):
                Path(filename).write_bytes(b"fake-mp3")
            with patch.object(tts, "edge", side_effect=edge), patch.object(tts, "piper") as fallback:
                result = await tts.synthesize("Merhaba", "voice", "missing-model", base)
            self.assertEqual(Path(result).read_bytes(), b"fake-mp3")
            fallback.assert_not_called()


if __name__ == "__main__":
    unittest.main()

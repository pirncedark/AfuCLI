import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import arama as bridge
from arama import Arama, TelegramBinding, jsonl


class Binding:
    def __init__(self):
        self.calls = []
        self.closed = False

    async def ara(self, user, heard, ended):
        self.calls.append(user)
        self.heard = heard
        self.ended = ended

    async def soyle(self, file):
        self.calls.append(file)

    async def kapat(self):
        self.closed = True


class CleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_hung_disconnect_cannot_keep_recordings(self):
        started = asyncio.Event()
        release = asyncio.Event()

        class Client:
            async def disconnect(self):
                started.set()
                await release.wait()

        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "duyulan-active.wav"
            file.write_bytes(b"recording")
            binding = TelegramBinding(1, "test")
            binding.client = Client()
            binding.calls = object()
            binding.files.add(file)
            task = asyncio.create_task(binding.kapat())
            try:
                await asyncio.wait_for(started.wait(), 1)
                self.assertFalse(file.exists())
                self.assertEqual(binding.files, set())
                self.assertIsNone(binding.calls)
            finally:
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task

    async def test_close_timeout_removes_recordings(self):
        class Client:
            async def disconnect(self):
                await asyncio.Event().wait()

        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "duyulan-cancelled.wav"
            file.write_bytes(b"recording")
            binding = TelegramBinding(1, "test")
            binding.client = Client()
            binding.files.add(file)
            with self.assertRaises(TimeoutError):
                await Arama(binding, 42).close()
            self.assertFalse(file.exists())
            self.assertEqual(binding.files, set())
            self.assertIsNone(binding.client)


class StartupTests(unittest.TestCase):
    def test_startup_removes_only_old_recordings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = [root / "duyulan-one.wav", root / "duyulan-two.wav"]
            keep = [root / "reply.wav", root / "ikinci-numara.session", root / "duyulan-note.txt"]
            for file in old + keep:
                file.write_bytes(b"data")
            with patch.object(bridge, "DIRECTORY", root), \
                    patch.object(bridge.sys, "argv", ["arama.py", "--check"]), \
                    patch.object(bridge.sys, "stdout", io.StringIO()):
                bridge.main()
            self.assertTrue(all(not file.exists() for file in old))
            self.assertTrue(all(file.exists() for file in keep))


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_jsonl_call_speech_and_close(self):
        binding = Binding()
        output = io.StringIO()
        await jsonl(Arama(binding, 42), io.StringIO('{"ara":42}\n{"soyle":"reply.wav"}\n{"kapat":true}\n'), output)
        self.assertEqual([json.loads(x) for x in output.getvalue().splitlines()],
                         [{"baglandi": True}, {"bitti": True}])
        self.assertEqual(binding.calls, [42, "reply.wav"])
        self.assertTrue(binding.closed)

    async def test_invalid_json_and_wrong_recipient_never_dial(self):
        binding = Binding()
        output = io.StringIO()
        await jsonl(Arama(binding, 42), io.StringIO('oops\n{"ara":-1}\n{"ara":43}\n{"ara":true}\n'), output)
        self.assertEqual(binding.calls, [])
        events = [json.loads(x) for x in output.getvalue().splitlines()]
        self.assertEqual(sum("hata" in x for x in events), 4)
        self.assertEqual(events[-1], {"bitti": True})

    async def test_received_file_and_remote_hangup_are_events(self):
        binding = Binding()
        events = []
        arama = Arama(binding, 42)
        arama.emit = events.append
        await arama.command({"ara": 42})
        binding.heard("heard.wav")
        binding.ended()
        self.assertEqual(events, [{"baglandi": True}, {"duyulan": "heard.wav"}, {"bitti": True}])
        await arama.close()
        self.assertTrue(binding.closed)
        self.assertEqual(sum("bitti" in x for x in events), 1)

    async def test_eof_and_binding_failure_close_without_secret(self):
        class Broken(Binding):
            async def ara(self, *args):
                raise RuntimeError("API_HASH=secret")
        binding = Broken()
        output = io.StringIO()
        await jsonl(Arama(binding, 42), io.StringIO('{"ara":42}\n'), output)
        self.assertNotIn("secret", output.getvalue())
        self.assertTrue(binding.closed)
        self.assertIn('"bitti": true', output.getvalue())


if __name__ == "__main__":
    unittest.main()

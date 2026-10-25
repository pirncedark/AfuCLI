import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path

from arama import Arama, jsonl


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

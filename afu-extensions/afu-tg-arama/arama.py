"""Telethon userbot bridge. stdout is exclusively the JSONL protocol."""
import asyncio
import contextlib
import importlib
import json
import math
import os
import struct
import sys
import tempfile
import wave
from datetime import datetime, timezone, timedelta
from pathlib import Path

from telethon import TelegramClient
from pytgcalls import PyTgCalls
from pytgcalls.types import ChatUpdate, Device, Direction, RecordStream, StreamFrames
from pytgcalls.types.raw import AudioParameters, AudioStream, Stream
from ntgcalls import MediaSource

DIRECTORY = Path.home() / ".omp" / "afu-tg-arama"
SESSION = DIRECTORY / "ikinci-numara.session"
RATE = 48000


def settings():
    api_id = int(os.environ.get("AFU_TG_API_ID", "0"))
    api_hash = os.environ.get("AFU_TG_API_HASH", "").strip()
    target = int(os.environ.get("AFU_TG_ARANAN", "0"))
    if api_id <= 0 or not api_hash or target <= 0:
        raise ValueError("Arama bilgileri eksik, üç ortam değişkenini ayarlayın.")
    return api_id, api_hash, target


def quiet_hour():
    # Istanbul has fixed UTC+03:00; works on Windows without optional tzdata.
    return datetime.now(timezone(timedelta(hours=3))).hour < 9


class Arama:
    def __init__(self, binding, target):
        self.binding = binding
        self.target = target
        self.active = False
        self.finished = False
        self.closed = False
        self.emit = lambda event: None

    def heard(self, file):
        if self.active:
            self.emit({"duyulan": str(file)})

    def ended(self):
        self.active = False
        if not self.finished:
            self.finished = True
            self.emit({"bitti": True})

    async def command(self, command):
        if not isinstance(command, dict) or len(command) != 1:
            raise ValueError("Geçersiz arama isteği.")
        if "ara" in command:
            user = command["ara"]
            if type(user) is not int or user <= 0 or user != self.target or self.active or self.finished:
                raise ValueError("Aranacak kişi geçersiz.")
            self.active = True
            try:
                await self.binding.ara(user, self.heard, self.ended)
            except Exception:
                self.active = False
                raise
            if self.active:
                self.emit({"baglandi": True})
        elif "soyle" in command:
            file = command["soyle"]
            if not self.active or not isinstance(file, str) or not file:
                raise ValueError("Arama açık değil veya ses dosyası geçersiz.")
            await self.binding.soyle(file)
        elif command.get("kapat") is True:
            await self.close()
        else:
            raise ValueError("Geçersiz arama isteği.")

    async def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            await asyncio.wait_for(self.binding.kapat(), 1.2)
        finally:
            self.ended()


async def jsonl(arama, source, output):
    def emit(event):
        output.write(json.dumps(event, ensure_ascii=True) + "\n")
        output.flush()
    arama.emit = emit
    task = None
    try:
        while not arama.finished:
            line = await asyncio.to_thread(source.readline, 16385)
            if not line:
                break
            try:
                if len(line) > 16384:
                    raise ValueError("İstek çok uzun.")
                command = json.loads(line)
                if command == {"kapat": True}:
                    break
                if task:
                    if not task.done():
                        raise ValueError("Önceki istek sürüyor.")
                    await task
                    task = None
                # Keep stdin responsive while dialing or playing audio.
                async def dispatch(value):
                    try:
                        await arama.command(value)
                    except Exception:
                        emit({"hata": "Arama işlemi tamamlanamadı, giriş ve ses kurulumunu kontrol edin."})
                task = asyncio.create_task(dispatch(command))
            except Exception:
                emit({"hata": "Arama işlemi tamamlanamadı, giriş ve ses kurulumunu kontrol edin."})
    finally:
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        with contextlib.suppress(Exception):
            await arama.close()


class TelegramBinding:
    def __init__(self, api_id, api_hash):
        self.api_id, self.api_hash = api_id, api_hash
        self.client = None
        self.calls = None
        self.user = None
        self.buffer = bytearray()
        self.silent = 0
        self.speaking = False
        self.files = set()
        self.heard = lambda file: None
        self.ended = lambda: None

    async def ara(self, user, heard, ended):
        if quiet_hour():
            raise ValueError("Sessiz saatte arama yapılamaz.")
        if not SESSION.is_file():
            raise ValueError("Önce giris.py ile ikinci numarayı bağlayın.")
        self.heard, self.ended, self.user = heard, ended, user
        self.client = TelegramClient(str(SESSION), self.api_id, self.api_hash)
        await self.client.connect()
        if not await self.client.is_user_authorized():
            raise ValueError("Oturum geçersiz, giris.py ile yeniden giriş yapın.")
        me = await self.client.get_me()
        if me.id == user or me.bot:
            raise ValueError("Arayan hesap ikinci numara olmalıdır.")
        self.calls = PyTgCalls(self.client)

        @self.calls.on_update()
        async def update(_, event):
            if event.chat_id != self.user:
                return
            if isinstance(event, ChatUpdate) and event.status & ChatUpdate.Status.LEFT_CALL:
                self.ended()
            elif (isinstance(event, StreamFrames) and event.direction == Direction.INCOMING
                  and event.device == Device.MICROPHONE and not self.speaking):
                for frame in event.frames:
                    self.receive(frame.frame)

        await self.calls.start()
        stream = Stream(microphone=AudioStream(MediaSource.EXTERNAL, "", AudioParameters(RATE, 1)))
        await self.calls.play(user, stream)
        await self.calls.record(user, RecordStream(audio=True, audio_parameters=AudioParameters(RATE, 1)))

    def receive(self, pcm):
        """Segment mono PCM at 800 ms trailing silence or 15 s, bounded memory."""
        if not pcm or len(pcm) % 2:
            return
        samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
        rms = math.sqrt(sum(x * x for x in samples) / len(samples))
        if not self.buffer and rms < 300:
            return
        self.buffer.extend(pcm)
        self.silent = self.silent + len(pcm) if rms < 300 else 0
        if self.silent < RATE * 2 * 0.8 and len(self.buffer) < RATE * 2 * 15:
            return
        data = bytes(self.buffer)
        self.buffer.clear()
        self.silent = 0
        self.files = {p for p in self.files if p.exists()}
        if len(self.files) >= 2:
            return
        handle, name = tempfile.mkstemp(prefix="duyulan-", suffix=".wav", dir=DIRECTORY)
        os.close(handle)
        file = Path(name)
        self.files.add(file)
        with wave.open(str(file), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(data)
        self.heard(str(file))
        # TS consumes and unlinks files; forget consumed paths instead of growing forever.
        self.files = {p for p in self.files if p.exists()}

    async def soyle(self, file):
        if not Path(file).is_file() or not self.calls:
            raise ValueError("Ses dosyası bulunamadı.")
        self.speaking = True
        self.buffer.clear()
        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", file,
                "-ar", str(RATE), "-ac", "1", "-f", "s16le", "pipe:1",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                **({"creationflags": 0x08000000} if os.name == "nt" else {}))
            # 20 ms mono frames, paced against a monotonic clock.
            deadline = asyncio.get_running_loop().time()
            while True:
                try:
                    frame = await process.stdout.readexactly(1920)
                except asyncio.IncompleteReadError as error:
                    frame = error.partial
                    if not frame:
                        break
                    frame = frame.ljust(1920, b"\0")
                await self.calls.send_frame(self.user, Device.MICROPHONE, frame)
                deadline += 0.02
                await asyncio.sleep(max(0, deadline - asyncio.get_running_loop().time()))
            if await process.wait() != 0:
                raise RuntimeError("Ses dönüştürülemedi.")
        finally:
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            self.silent = 0
            self.speaking = False

    async def kapat(self):
        try:
            if self.calls and self.user:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self.calls.leave_call(self.user), 0.5)
        finally:
            for file in self.files:
                file.unlink(missing_ok=True)
            self.files.clear()
            self.calls = None
            client = self.client
            self.client = None
            if client:
                await client.disconnect()


def main():
    for file in DIRECTORY.glob("duyulan-*.wav"):
        file.unlink(missing_ok=True)
    if sys.argv[1:] == ["--check"]:
        for name in ("pytgcalls", "telethon", "ntgcalls"):
            importlib.import_module(name)
        print("ok")
        return
    protocol = sys.stdout
    try:
        api_id, api_hash, target = settings()
        # PyTgCalls startup notice and third-party prints must never enter JSONL.
        with contextlib.redirect_stdout(sys.stderr):
            asyncio.run(jsonl(Arama(TelegramBinding(api_id, api_hash), target), sys.stdin, protocol))
    except Exception:
        protocol.write(json.dumps({"hata": "Arama başlatılamadı, ortam bilgilerini ve ikinci numara girişini kontrol edin."}) + "\n")
        protocol.write('{"bitti":true}\n')
        protocol.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()

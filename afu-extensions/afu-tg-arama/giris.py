"""One-time interactive login, always with a SECOND phone number."""
import asyncio
import getpass
import os
import sys

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from arama import DIRECTORY, SESSION, settings


async def login():
    api_id, api_hash, target = settings()
    print("Yalnız ikinci numara ile giriş yapın; ana hesabı ASLA kullanmayın.")
    if input("İkinci numara kullandığınızı onaylamak için IKINCI yazın: ").strip() != "IKINCI":
        return
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    client = TelegramClient(str(SESSION), api_id, api_hash)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            phone = input("İkinci telefon numarası (+ülke koduyla): ").strip()
            await client.send_code_request(phone)
            code = getpass.getpass("Telegram giriş kodu: ")
            try:
                await client.sign_in(phone, code)
            except SessionPasswordNeededError:
                await client.sign_in(password=getpass.getpass("İki aşamalı doğrulama parolası: "))
        me = await client.get_me()
        if me.id == target or me.bot:
            await client.log_out()
            raise ValueError("İkinci numara gerekli.")
        if os.name != "nt":
            SESSION.chmod(0o600)
        print("Giriş tamamlandı; AfuCLI içinde /ara yazın.")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(login())
    except (Exception, KeyboardInterrupt):
        print("Giriş tamamlanamadı; ikinci numara ve giriş bilgilerini kontrol edip yeniden deneyin.", file=sys.stderr)
        sys.exit(1)

import edge_tts
import asyncio

async def generate_speech(text: str, output_path: str):
    """Generate speech using Microsoft Edge TTS returning a path to the generated audio."""
    # en-IE-EmilyNeural = Irish English female — matches MCU F.R.I.D.A.Y. (Kerry Condon)
    voice = "en-IE-EmilyNeural"
    try:
        communicate = edge_tts.Communicate(text, voice, rate="+10%")
        await communicate.save(output_path)
        return {"status": "success", "file": output_path}
    except Exception as e:
        return {"error": str(e)}

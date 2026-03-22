"""
Custom LiveKit TTS plugin using Microsoft Edge-TTS.

Preserves F.R.I.D.A.Y.'s Irish female voice (en-IE-EmilyNeural).
Converts edge-tts MP3 output to raw PCM for LiveKit's audio pipeline.
Wrapped with StreamAdapter in agent.py for per-sentence streaming.
"""

import asyncio
import logging
import struct
import edge_tts
import miniaudio
from livekit.agents import tts, utils
from livekit.agents.types import APIConnectOptions

logger = logging.getLogger("friday.edge-tts")

# edge-tts outputs MP3 at 24kHz mono by default
OUTPUT_SAMPLE_RATE = 24000
OUTPUT_CHANNELS = 1


class EdgeTTS(tts.TTS):
    """Edge-TTS adapter for LiveKit agents framework."""

    def __init__(
        self,
        *,
        voice: str = "en-IE-EmilyNeural",
        rate: str = "+10%",
        volume: str = "+0%",
        pitch: str = "+0Hz",
    ):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=OUTPUT_SAMPLE_RATE,
            num_channels=OUTPUT_CHANNELS,
        )
        self._voice = voice
        self._rate = rate
        self._volume = volume
        self._pitch = pitch

    def synthesize(self, text: str, *, conn_options: APIConnectOptions = APIConnectOptions()) -> "EdgeTTSChunkedStream":
        return EdgeTTSChunkedStream(
            tts=self,
            text=text,
            conn_options=conn_options,
            voice=self._voice,
            rate=self._rate,
            volume=self._volume,
            pitch=self._pitch,
        )


class EdgeTTSChunkedStream(tts.ChunkedStream):
    """Synthesize text via edge-tts and push PCM frames to LiveKit."""

    def __init__(self, *, tts: EdgeTTS, text: str, conn_options: APIConnectOptions, voice: str, rate: str, volume: str, pitch: str):
        super().__init__(tts=tts, input_text=text, conn_options=conn_options)
        self._text = text
        self._voice = voice
        self._rate = rate
        self._volume = volume
        self._pitch = pitch

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        """Generate speech via edge-tts, convert MP3→PCM, push to emitter."""
        try:
            # Collect MP3 data from edge-tts
            communicate = edge_tts.Communicate(
                self._text,
                self._voice,
                rate=self._rate,
                volume=self._volume,
                pitch=self._pitch,
            )

            mp3_data = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    mp3_data.extend(chunk["data"])

            if not mp3_data:
                logger.warning("edge-tts returned no audio data")
                return

            # Convert MP3 to raw PCM using miniaudio (no ffmpeg needed)
            pcm_bytes = await asyncio.to_thread(self._mp3_to_pcm, bytes(mp3_data))

            if not pcm_bytes:
                logger.warning("MP3 to PCM conversion produced no data")
                return

            # Initialize emitter and push PCM audio
            request_id = utils.shortuuid()
            output_emitter.initialize(
                request_id=request_id,
                sample_rate=OUTPUT_SAMPLE_RATE,
                num_channels=OUTPUT_CHANNELS,
                mime_type="audio/pcm",
            )
            output_emitter.push(pcm_bytes)
            output_emitter.flush()

            logger.info(
                f"Synthesized {len(self._text)} chars -> {len(pcm_bytes)} PCM bytes "
                f"({len(pcm_bytes) / (OUTPUT_SAMPLE_RATE * 2):.1f}s)"
            )

        except Exception as e:
            logger.error(f"edge-tts synthesis failed: {e}")
            raise

    @staticmethod
    def _mp3_to_pcm(mp3_data: bytes) -> bytes:
        """Convert MP3 bytes to 16-bit PCM at 24kHz mono using miniaudio (no ffmpeg)."""
        decoded = miniaudio.decode(
            mp3_data,
            output_format=miniaudio.SampleFormat.SIGNED16,
            nchannels=OUTPUT_CHANNELS,
            sample_rate=OUTPUT_SAMPLE_RATE,
        )
        # miniaudio returns array of samples, pack as raw 16-bit LE bytes
        return struct.pack(f"<{len(decoded.samples)}h", *decoded.samples)

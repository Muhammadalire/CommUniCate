export class AudioStreamer {
  private audioCtx: AudioContext;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
  }

  // For base64-encoded PCM16 audio (kept for compatibility)
  addPCM16(base64: string, sampleRate: number = 24000) {
    try {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      this.playPCM16Buffer(bytes.buffer, sampleRate);
    } catch (error) {
      console.error("Error processing audio chunk:", error);
    }
  }

  // For raw ArrayBuffer PCM16 audio (used by Deepgram Aura)
  addRawPCM16(buffer: ArrayBuffer, sampleRate: number = 24000) {
    try {
      this.playPCM16Buffer(buffer, sampleRate);
    } catch (error) {
      console.error("Error processing raw audio chunk:", error);
    }
  }

  private playPCM16Buffer(buffer: ArrayBuffer, sampleRate: number) {
    // Robustness: Int16Array requires a multiple of 2 bytes.
    // If we get an odd-length buffer, slice off the last byte.
    let targetBuffer = buffer;
    if (buffer.byteLength % 2 !== 0) {
      targetBuffer = buffer.slice(0, buffer.byteLength - 1);
    }
    const pcm16 = new Int16Array(targetBuffer);

    const audioBuffer = this.audioCtx.createBuffer(1, pcm16.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768.0;
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);

    // Schedule playback to be gapless
    if (this.nextPlayTime < this.audioCtx.currentTime) {
      this.nextPlayTime = this.audioCtx.currentTime + 0.05;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;

    // Track active sources for interruption
    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx > -1) this.activeSources.splice(idx, 1);
    };
  }

  stop() {
    // Stop all currently playing/scheduled audio sources
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    });
    this.activeSources = [];
    this.nextPlayTime = 0;
  }

  isPlaying(): boolean {
    return this.activeSources.length > 0;
  }
}

export function createAudioProcessor(
  audioCtx: AudioContext,
  stream: MediaStream,
  onData: (pcmData: ArrayBuffer) => void
) {
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    const pcm16 = new Int16Array(inputData.length);

    for (let i = 0; i < inputData.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
    }

    // Send raw ArrayBuffer for Deepgram WebSocket
    onData(pcm16.buffer);
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  return {
    stop: () => {
      source.disconnect();
      processor.disconnect();
    },
  };
}

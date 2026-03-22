export class AudioStreamer {
  private audioCtx: AudioContext;
  private nextPlayTime: number = 0;

  constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
  }

  addPCM16(base64: string) {
    try {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // The Gemini Live API returns 16-bit PCM
      const pcm16 = new Int16Array(bytes.buffer);
      
      // The output sample rate is 24000Hz
      const audioBuffer = this.audioCtx.createBuffer(1, pcm16.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      
      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0;
      }

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioCtx.destination);

      // Schedule playback to be gapless
      if (this.nextPlayTime < this.audioCtx.currentTime) {
        this.nextPlayTime = this.audioCtx.currentTime + 0.05; // small buffer
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
    } catch (error) {
      console.error("Error processing audio chunk:", error);
    }
  }

  stop() {
    this.nextPlayTime = 0;
  }
}

export function createAudioProcessor(
  audioCtx: AudioContext, 
  stream: MediaStream, 
  onData: (base64: string) => void
) {
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    const pcm16 = new Int16Array(inputData.length);
    
    for (let i = 0; i < inputData.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
    }
    
    const buffer = new ArrayBuffer(pcm16.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < pcm16.length; i++) {
      view.setInt16(i * 2, pcm16[i], true); // little endian
    }
    
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    onData(btoa(binary));
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  return {
    stop: () => {
      source.disconnect();
      processor.disconnect();
    }
  };
}

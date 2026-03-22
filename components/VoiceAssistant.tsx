'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Loader2, Info, MessageCircle, Headphones, Sparkles, Trophy, Car, Music, Globe, User } from 'lucide-react';
import { AudioStreamer, createAudioProcessor } from '@/lib/audio-utils';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

const MODES = [
  { id: 'chatty', label: 'Chatty', icon: MessageCircle },
  { id: 'listener', label: 'Listener', icon: Headphones },
  { id: 'gossipy', label: 'Gossipy', icon: Sparkles },
];

const INTERESTS = [
  { id: 'General', label: 'General', icon: Globe },
  { id: 'Football', label: 'Football', icon: Trophy },
  { id: 'Cars', label: 'Cars', icon: Car },
  { id: 'Pop', label: 'Pop Culture', icon: Music },
];

// Using Fish Audio reference_ids
const VOICES = [
  '7f92f8afb8ec43bf8142d9eec1e52dbb', // Alex (M)
  '54a5170264694bfc862bbc0e5d4dda1e', // Sarah (F)
  '802e3bc2b27e49c2995d23ef70e6ac89', // Henry (M)
];

const VOICE_LABELS: Record<string, string> = {
  '7f92f8afb8ec43bf8142d9eec1e52dbb': 'Alex (M)',
  '54a5170264694bfc862bbc0e5d4dda1e': 'Sarah (F)',
  '802e3bc2b27e49c2995d23ef70e6ac89': 'Henry (M)',
};

export default function VoiceAssistant() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [mode, setMode] = useState('chatty');
  const [interest, setInterest] = useState('General');
  const [voice, setVoice] = useState(VOICES[1]); // Default to Female

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<{ stop: () => void } | null>(null);
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pipeline State
  const dgSocketRef = useRef<WebSocket | null>(null);
  const keepAliveRef = useRef<NodeJS.Timeout | null>(null);
  const messagesRef = useRef<{ role: string, content: string }[]>([]);

  const getSystemInstruction = () => {
    let base = "";
    if (mode === 'chatty') base = "You are Aura, a chatty, highly energetic, and friendly conversational partner. Keep the conversation flowing with lots of enthusiasm. ";
    if (mode === 'listener') base = "You are Aura, an empathetic, active listener. Speak less, ask thoughtful open-ended questions, and give the user plenty of space to talk and express themselves. ";
    if (mode === 'gossipy') base = "You are Aura, a gossipy, fun friend who loves talking about celebrity trends, pop culture drama, and the latest rumors. Spill the tea and be dramatic! ";

    let topic = "";
    if (interest === 'Football') topic = "Focus the conversation heavily on football (soccer/American football depending on context), recent matches, players, and tactics. ";
    if (interest === 'Cars') topic = "Focus the conversation heavily on cars, automotive trends, racing, and vehicle mechanics. ";
    if (interest === 'Pop') topic = "Focus the conversation on pop culture, movies, music, and trending internet topics. ";

    return base + topic + "Keep your responses brief (1-3 sentences) to encourage a back-and-forth dialogue. Do not sound robotic or overly formal. Respond directly to the user's input.";
  };

  const processAIResponse = async (userText: string) => {
    if (!userText.trim()) return;

    // Local context management
    const currentMessages = [...messagesRef.current, { role: 'user', content: userText }];
    messagesRef.current = currentMessages;

    // Show processing state visually if needed
    setIsSpeaking(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentMessages.slice(-10), // Keep last 10 messages for context
          systemInstruction: getSystemInstruction(),
          voice: voice
        })
      });

      if (!response.ok) throw new Error('Failed to get AI response');

      const data = await response.json();

      // Save AI response to context map
      messagesRef.current.push({ role: 'assistant', content: data.text });

      // Play audio
      if (data.audio && audioStreamerRef.current) {
        // Fish Audio returns PCM 16-bit. The route sends it as base64.
        // Fish Audio typically uses 44100Hz default for TTS
        const binaryString = atob(data.audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        audioStreamerRef.current.addRawPCM16(bytes.buffer, 44100);

        // Manage speaking visual state
        if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = setTimeout(() => {
          if (!audioStreamerRef.current?.isPlaying()) {
            setIsSpeaking(false);
          }
        }, 1000);
      } else {
        setIsSpeaking(false);
      }

    } catch (err: any) {
      console.error("Pipeline Error:", err);
      // setErrorMessage("Error getting response.");
      setIsSpeaking(false);
    }
  };

  const setupDeepgramWebSocket = () => {
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("Missing NEXT_PUBLIC_DEEPGRAM_API_KEY in .env.local");
    }

    const socket = new WebSocket('wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1', [
      'token',
      apiKey,
    ]);

    socket.onopen = () => {
      setConnectionState('connected');

      // Keep-alive heartbeat (Deepgram closes socket after 10s of silence otherwise)
      keepAliveRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 5000);

      // Trigger initial greeting via the pipeline
      processAIResponse("Hello! Please introduce yourself and start our conversation.");
    };

    socket.onmessage = (message) => {
      const received = JSON.parse(message.data);
      const transcript = received.channel?.alternatives[0]?.transcript;

      if (transcript && received.is_final) {
        console.log("Transcribed:", transcript);

        // Interruption handling (if user speaks while AI is playing)
        if (audioStreamerRef.current?.isPlaying()) {
          audioStreamerRef.current.stop();
          setIsSpeaking(false);
        }

        processAIResponse(transcript);
      }
    };

    socket.onclose = () => {
      console.log("Deepgram socket closed");
      disconnect();
    };

    socket.onerror = (error) => {
      console.error("Deepgram Socket Error:", error);
      setErrorMessage("Microphone connection error. Please check your API key.");
      disconnect();
    };

    dgSocketRef.current = socket;
    return socket;
  };

  const connect = async () => {
    try {
      setConnectionState('connecting');
      setErrorMessage('');
      messagesRef.current = []; // clear history on new session

      // 1. Initialize Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      // We process microphone at 16000Hz for Deepgram Speech-to-Text
      const audioCtx = new AudioContextClass({ sampleRate: 16000 });
      await audioCtx.resume();
      audioCtxRef.current = audioCtx;

      const streamer = new AudioStreamer(audioCtx);
      audioStreamerRef.current = streamer;

      // 2. Get Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 3. Setup Deepgram STT WebSocket
      const socket = setupDeepgramWebSocket();

      // 4. Start processing microphone data
      processorRef.current = createAudioProcessor(audioCtx, stream, (rawPcmBuffer) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(rawPcmBuffer);
        }
      });

    } catch (err: any) {
      console.error("Setup Error:", err);
      setErrorMessage(err.message || "Failed to access microphone or connect pipeline.");
      disconnect();
    }
  };

  const disconnect = () => {
    setConnectionState('idle');
    setIsSpeaking(false);

    if (processorRef.current) {
      processorRef.current.stop();
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }

    if (dgSocketRef.current) {
      dgSocketRef.current.close();
      dgSocketRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      disconnect();
      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    };
  }, []);

  // Use a faster pulse effect when speaking (to emulate the snappy Groq speed)
  // Ensure we continually poll audioStreamer to reset isSpeaking if audio finishes naturally
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSpeaking) {
      interval = setInterval(() => {
        if (audioStreamerRef.current && !audioStreamerRef.current.isPlaying()) {
          setIsSpeaking(false);
        }
      }, 200);
    }
    return () => {
      if (interval) clearInterval(interval);
    }
  }, [isSpeaking])


  return (
    <div className="min-h-screen bg-[#FAF7F2] flex flex-col items-center justify-between p-4 md:p-8 relative overflow-hidden font-sans text-stone-800 selection:bg-orange-200">
      {/* Soft background gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-rose-200/40 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-orange-200/40 blur-[150px]" />
      </div>

      {/* Header */}
      <header className="w-full max-w-6xl flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-400 to-orange-400 shadow-lg shadow-orange-500/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-800">Aura</h1>
        </div>
        <div className="flex items-center gap-3 bg-white/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/60 shadow-sm">
          <span className="relative flex h-2.5 w-2.5">
            {connectionState === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connectionState === 'connected' ? 'bg-emerald-500' : 'bg-stone-300'}`}></span>
          </span>
          <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
            {connectionState === 'connected' ? 'Live' : 'Standby'}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-6xl flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-24 z-10 flex-1 my-8">

        {/* Left Column: The Orb & Main Action */}
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md">
          {/* The Orb */}
          <div className="relative w-72 h-72 flex items-center justify-center mb-12">
            <AnimatePresence>
              {connectionState === 'connected' && (
                <>
                  {/* Outer breathing glow */}
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{
                      scale: isSpeaking ? [1, 1.3, 1] : [1, 1.05, 1],
                      opacity: isSpeaking ? [0.7, 0.9, 0.7] : [0.4, 0.6, 0.4]
                    }}
                    transition={{
                      duration: isSpeaking ? 0.8 : 3, // Faster pulse when speaking for that "instant Groq" feel
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="absolute w-full h-full rounded-full bg-gradient-to-tr from-rose-300 to-orange-300 blur-3xl"
                  />

                  {/* Inner solid orb */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute w-48 h-48 rounded-full bg-gradient-to-tr from-rose-100 to-orange-50 shadow-[0_0_50px_rgba(251,146,60,0.4)] border border-white flex items-center justify-center overflow-hidden"
                  >
                    {/* Inner subtle pulse */}
                    <motion.div
                      animate={{ scale: isSpeaking ? [1, 1.15, 1] : 1 }}
                      transition={{ duration: 0.4, repeat: Infinity }}
                      className="w-full h-full bg-gradient-to-tr from-rose-200/50 to-orange-200/50 rounded-full"
                    />
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            {/* Idle State Orb */}
            {connectionState !== 'connected' && (
              <div className="absolute w-48 h-48 rounded-full bg-white/40 border border-white/60 backdrop-blur-md shadow-xl flex items-center justify-center transition-all duration-500">
                <div className="w-24 h-24 rounded-full bg-stone-200/50 flex items-center justify-center">
                  <MicOff className="w-8 h-8 text-stone-400" />
                </div>
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="text-rose-500 text-sm text-center bg-rose-50 px-4 py-3 rounded-xl border border-rose-100 mb-6 w-full shadow-sm">
              {errorMessage}
            </div>
          )}

          <button
            onClick={connectionState === 'idle' || connectionState === 'error' ? connect : disconnect}
            disabled={connectionState === 'connecting'}
            className={`
              relative group flex items-center justify-center gap-3 w-full max-w-[280px] py-4 rounded-2xl font-semibold text-lg transition-all duration-300
              ${connectionState === 'connected'
                ? 'bg-stone-800 text-white hover:bg-stone-700 shadow-xl hover:shadow-2xl hover:-translate-y-1'
                : 'bg-gradient-to-r from-rose-400 to-orange-400 text-white shadow-xl shadow-orange-500/30 hover:shadow-orange-500/50 hover:-translate-y-1'
              }
              disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none
            `}
          >
            {connectionState === 'connecting' ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : connectionState === 'connected' ? (
              <>
                <MicOff className="w-6 h-6" />
                <span>End Conversation</span>
              </>
            ) : (
              <>
                <Mic className="w-6 h-6" />
                <span>Start Conversation</span>
              </>
            )}
          </button>
        </div>

        {/* Right Column: Settings / Configuration */}
        <div className="flex-1 w-full max-w-md flex flex-col gap-8 bg-white/60 backdrop-blur-2xl p-8 rounded-[2rem] border border-white shadow-2xl shadow-stone-200/50 relative">

          {/* Disable overlay when connected */}
          {connectionState === 'connected' && (
            <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] z-20 rounded-[2rem] flex items-center justify-center">
              <div className="bg-stone-800 text-white px-6 py-3 rounded-full text-sm font-medium shadow-xl flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Disconnect to change settings
              </div>
            </div>
          )}

          {/* Modes */}
          <div>
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <User className="w-4 h-4" /> Persona Mode
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {MODES.map((m) => {
                const Icon = m.icon;
                const isActive = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all duration-200 ${isActive
                      ? 'bg-stone-800 border-stone-800 text-white shadow-md'
                      : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300 hover:bg-stone-50'
                      }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-orange-300' : 'text-stone-400'}`} />
                    <span className="text-xs font-semibold">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interests */}
          <div>
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Topic of Interest
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {INTERESTS.map((i) => {
                const Icon = i.icon;
                const isActive = interest === i.id;
                return (
                  <button
                    key={i.id}
                    onClick={() => setInterest(i.id)}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition-all duration-200 ${isActive
                      ? 'bg-orange-100 border-orange-200 text-orange-800 shadow-sm'
                      : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50'
                      }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-orange-500' : 'text-stone-400'}`} />
                    <span className="text-sm font-medium">{i.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voices */}
          <div>
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Mic className="w-4 h-4" /> Fish Audio Voice
            </h3>
            <div className="flex flex-wrap gap-2">
              {VOICES.map((v) => {
                const isActive = voice === v;
                return (
                  <button
                    key={v}
                    onClick={() => setVoice(v)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${isActive
                      ? 'bg-stone-800 border-stone-800 text-white shadow-md'
                      : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50'
                      }`}
                  >
                    {VOICE_LABELS[v]}
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      </main>

      {/* Architecture Note */}
      <div className="w-full flex justify-center z-10 mt-auto pt-8">
        <div className="flex items-start gap-3 max-w-2xl bg-white/40 backdrop-blur-md p-4 rounded-2xl border border-white/60 text-xs text-stone-500 leading-relaxed shadow-sm">
          <Info className="w-5 h-5 shrink-0 mt-0.5 text-stone-400" />
          <p>
            <strong>Architecture Note:</strong> This version is powered by a low-latency pipeline using <strong>Deepgram Nova-3</strong> for STT, <strong>Groq + Llama 3.3</strong> for intelligence, and <strong>Fish Audio</strong> for TTS.
          </p>
        </div>
      </div>
    </div>
  );
}

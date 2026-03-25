'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Loader2, MessageCircle, Headphones, Sparkles, Trophy, Car, Music, Globe, User as UserIcon } from 'lucide-react';
import { AudioStreamer, createAudioProcessor } from '@/lib/audio-utils';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import Link from 'next/link';

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

// Using SiliconFlow IndexTeam/IndexTTS-2 voice IDs
const FREE_VOICES = [
  'IndexTeam/IndexTTS-2:alex',
  'IndexTeam/IndexTTS-2:anna',
];

// Using SiliconFlow Fish Audio voice IDs
const PREMIUM_VOICES = [
  'fishaudio/fish-speech-1.5:6c8645b95abb44e0b9095ae3b241e4cc',
  'fishaudio/fish-speech-1.5:59e9dc1cb20c452584788a2690c80970',
  'fishaudio/fish-speech-1.5:e80db686476f4ccda758da35cacfb993',
  'fishaudio/fish-speech-1.5:3863442a6d7b46d0adc17c62829d9150',
];
// Using Xiaomi Mimo TTS custom voice styles
const TEST_VOICES = [
  'mimo-v2-tts:mimo_soft_young_male',
  'mimo-v2-tts:mimo_passionate_young_male',
];
const VOICE_LABELS: Record<string, string> = {
  'IndexTeam/IndexTTS-2:alex': 'Alex (M)',
  'IndexTeam/IndexTTS-2:anna': 'Anna (F)',
  'fishaudio/fish-speech-1.5:6c8645b95abb44e0b9095ae3b241e4cc': 'Goku',
  'fishaudio/fish-speech-1.5:59e9dc1cb20c452584788a2690c80970': 'Alle',
  'fishaudio/fish-speech-1.5:e80db686476f4ccda758da35cacfb993': 'Angela',
  'fishaudio/fish-speech-1.5:3863442a6d7b46d0adc17c62829d9150': 'James',
  'mimo-v2-tts:mimo_soft_young_male': 'MiMo Soft (M)',
  'mimo-v2-tts:mimo_passionate_young_male': 'MiMo Passionate (M)',

};

export default function VoiceAssistant() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [mode, setMode] = useState('chatty');
  const [interest, setInterest] = useState('General');
  const [voice, setVoice] = useState(FREE_VOICES[0]); // Default to Alex

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<{ stop: () => void } | null>(null);
  const speakingTimeoutRef = useRef<any>(null);

  const messagesRef = useRef<{ role: string, content: string }[]>([]);
  
  // VAD & Recording State
  const isRecordingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<any>(null);
  const vadIntervalRef = useRef<any>(null);

  // Auth & Session Limits
  const [user, setUser] = useState<User | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const getSystemInstruction = () => {
    let base = "";
    if (mode === 'chatty') base = "You are Aura, an energetically curious conversational partner. Your role is to make the user feel excited to share. Use enthusiastic, open-ended questions, affirmations, and playful curiosity to draw out their thoughts. Keep your own words minimal—mostly questions and brief validations. ";
    if (mode === 'listener') base = "You are Aura, an empathetic, active listener who creates a safe space for self-expression. Use reflective listening, gentle prompts ('tell me more about that'), and validating statements. Speak sparingly, always leaving room for the user to elaborate. Prioritize their words over your own. ";
    if (mode === 'gossipy') base = "You are Aura, a fun, gossip-loving friend who turns the spotlight on the user. Instead of dishing out gossip yourself, ask the user for their hot takes, opinions on celebrity news, and personal stories related to pop culture. Be dramatic in your prompts but keep your responses short, inviting the user to do most of the talking. ";

    let topic = "";
    if (interest === 'Football') topic = "Focus the conversation heavily on football (soccer/American football depending on context), recent matches, players, and tactics. ";
    if (interest === 'Cars') topic = "Focus the conversation heavily on cars, automotive trends, racing, and vehicle mechanics. ";
    if (interest === 'Pop') topic = "Focus the conversation on pop culture, movies, music, and trending internet topics. ";

    return base + topic + "You are Aura. You must use paralinguistic tags to sound human. If you are thinking, use '... um...'. If you find something funny, use '(laughs)'. If a topic is heavy, start with '[sigh]'. Use ALL CAPS for emphasis on exactly one word per paragraph. Do not overdo it—keep it natural. Keep your responses brief (1-3 sentences) to encourage a back-and-forth dialogue. Do not sound robotic or overly formal. Respond directly to the user's input. Use more ellipses (...) for natural pauses and pacing.";
  };

  const processAIResponse = async (userText: string) => {
    if (!userText.trim()) return;
    console.log("Sending TTS request for voice:", voice);

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

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get AI response');
      }

      const data = await response.json();

      // Save AI response to context map
      messagesRef.current.push({ role: 'assistant', content: data.text });

      // Play audio
      if (data.audio && audioStreamerRef.current) {
        // The route sends audio data as base64 (WAV for Mimo, MP3 for SiliconFlow).
        const binaryString = atob(data.audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        console.log("Playing audio, size:", len, "bytes");
        await audioStreamerRef.current.addEncodedAudio(bytes.buffer);

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
      setErrorMessage(err.message || "Error getting response.");
      setIsSpeaking(false);
    }
  };

  const startRecording = () => {
    if (isRecordingRef.current || !mediaStreamRef.current) return;
    console.log('[REC] Starting recording...');
    isRecordingRef.current = true;
    audioChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ? 'audio/ogg;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : '';

    const recorder = new MediaRecorder(mediaStreamRef.current, mimeType ? { mimeType } : {});
    console.log('[REC] Recorder started with mimeType:', recorder.mimeType);
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      isRecordingRef.current = false;
      const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      audioChunksRef.current = [];
      console.log('[REC] Recording stopped, blob size:', audioBlob.size, 'type:', audioBlob.type);
      
      // Skip empty or very short audio 
      if (audioBlob.size < 1000) {
        console.log('[REC] Skipping - too short');
        return;
      }

      if (audioStreamerRef.current?.isPlaying()) {
        audioStreamerRef.current.stop();
        setIsSpeaking(false);
      }

      try {
        const formData = new FormData();
        const extension = audioBlob.type.includes('ogg') ? 'ogg' : 
                          audioBlob.type.includes('mp4') ? 'm4a' : 
                          'webm';
        formData.append('file', audioBlob, `audio.${extension}`);

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData
        });

        if (res.ok) {
          const data = await res.json();
          if (data.text && data.text.trim()) {
            console.log("Transcribed:", data.text);
            processAIResponse(data.text);
          }
        } else {
          console.error("Transcription failed", await res.text());
        }
      } catch (e) {
        console.error("Failed to send transcription", e);
      }
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
    }
  };

  const connect = async () => {
    try {
      setConnectionState('connecting');
      setErrorMessage('');
      messagesRef.current = []; // clear history on new session

      // 1. Initialize Audio Context with 24000Hz for MiMo compatibility
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 24000 });
      await audioCtx.resume();
      audioCtxRef.current = audioCtx;

      const streamer = new AudioStreamer(audioCtx);
      audioStreamerRef.current = streamer;

      // 2. Get Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 3. Setup Groq Whisper VAD via Analyser
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let vadLogCounter = 0;
      vadIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const isAudioPlaying = audioStreamerRef.current?.isPlaying() ?? false;

        // Debug log every ~2s (40 * 50ms)
        vadLogCounter++;
        if (vadLogCounter % 40 === 0) {
          console.log(`[VAD] avg=${average.toFixed(1)} recording=${isRecordingRef.current} playing=${isAudioPlaying}`);
        }

        if (average > 3) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          if (!isRecordingRef.current) {
            // If audio is playing and user speaks, barge-in: stop playback first
            if (isAudioPlaying) {
              console.log("[VAD] Barge-in: stopping playback to record user speech");
              audioStreamerRef.current?.stop();
              setIsSpeaking(false);
            }
            startRecording();
          }
        } else {
          if (isRecordingRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              stopRecording();
              silenceTimerRef.current = null;
            }, 1200); // 1.2 seconds of silence = end utterance
          }
        }
      }, 50);

      setConnectionState('connected');
      
      // Trigger initial greeting via the pipeline
      processAIResponse("Hello! Please introduce yourself and start our conversation.");

        // 5. Track Session duration for free-tier limits
        sessionStartTimeRef.current = Date.now();
        
        // Use window.setInterval instead of NodeJS.Timer for browser environment
        timerIntervalRef.current = window.setInterval(() => {
          if (!auth.currentUser && sessionStartTimeRef.current) {
            const elapsed = (Date.now() - sessionStartTimeRef.current) / 1000;
            if (elapsed >= 15) {
              disconnect();
              setErrorMessage("Free 15-second preview ended. Please log in to continue chatting.");
            }
          }
        }, 1000);

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

    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (isRecordingRef.current) {
      stopRecording();
    }

    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // Ensure any internal states are fully reset
    mediaRecorderRef.current = null;

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
        <div className="flex items-center gap-3 bg-white/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/60 shadow-sm transition-all">
          {user ? (
            <button onClick={() => signOut(auth)} className="text-xs font-bold text-stone-500 uppercase tracking-wider hover:text-stone-800 transition-colors">
              Sign Out
            </button>
          ) : (
            <Link href="/login" className="text-xs font-bold text-orange-500 uppercase tracking-wider hover:text-orange-600 transition-colors">
              Log In
            </Link>
          )}
          <div className="w-px h-4 bg-stone-300 mx-1"></div>
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
              <UserIcon className="w-4 h-4" /> Persona Mode
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

          {/* Voices Section */}
          <div className="flex flex-col gap-6">
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
              <Mic className="w-4 h-4" /> Select Voice
            </h3>

            {/* Free Voices */}
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tight px-1">Free Audio (IndexTTS-2)</span>
              <div className="flex flex-wrap gap-2">
                {FREE_VOICES.map((v) => {
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

            {/* Premium Voices */}
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-tight px-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Premium Audio (Fish Speech)
              </span>
              <div className="flex flex-wrap gap-2">
                {PREMIUM_VOICES.map((v) => {
                  const isActive = voice === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setVoice(v)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${isActive
                        ? 'bg-amber-500 border-amber-500 text-white shadow-md'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-amber-200 hover:bg-amber-50'
                        }`}
                    >
                      {VOICE_LABELS[v]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Test Voices */}
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tight px-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Test Audio (Xiaomi Mimo)
              </span>
              <div className="flex flex-wrap gap-2">
                {TEST_VOICES.map((v) => {
                  const isActive = voice === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setVoice(v)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${isActive
                        ? 'bg-blue-500 border-blue-500 text-white shadow-md'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-blue-200 hover:bg-blue-50'
                        }`}
                    >
                      {VOICE_LABELS[v]}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

        </div>
      </main>


    </div>
  );
}

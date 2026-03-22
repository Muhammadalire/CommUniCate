import { NextRequest } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function POST(req: NextRequest) {
    try {
        const { messages, systemInstruction, voice } = await req.json();

        // 1. Get LLM response from Groq (streaming)
        const chatCompletion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemInstruction },
                ...messages,
            ],
            temperature: 0.8,
            max_tokens: 300,
            stream: true,
        });

        // 2. Accumulate full text from stream
        let fullText = '';
        for await (const chunk of chatCompletion) {
            const content = chunk.choices[0]?.delta?.content || '';
            fullText += content;
        }

        if (!fullText.trim()) {
            return new Response(JSON.stringify({ error: 'Empty LLM response' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 3. Send text to Fish Audio TTS 
        // Uses mp3 format by default if not specified; we request PCM 16-bit 24kHz for the streamer
        const fishVoiceId = voice || '7f92f8afb8ec43bf8142d9eec1e52dbb'; // default to a good male voice if none provided
        const ttsResponse = await fetch('https://api.fish.audio/v1/tts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: fullText,
                reference_id: fishVoiceId,
                format: 'pcm', // Request raw PCM
                mp3_bitrate: 64, // Ignored for PCM but good to have
                latency: 'normal'
            }),
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            console.error('Fish Audio TTS error:', errorText);
            return new Response(JSON.stringify({ error: 'TTS failed' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 4. Return audio + text
        // Fish Audio returns raw binary audio data
        const audioBuffer = await ttsResponse.arrayBuffer();

        return new Response(
            JSON.stringify({
                text: fullText,
                audio: Buffer.from(audioBuffer).toString('base64'),
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            }
        );
    } catch (error: any) {
        console.error('API chat error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

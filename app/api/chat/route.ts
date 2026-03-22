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

        // 3. Send text to SiliconFlow (CosyVoice2-0.5B - Cheaper/Free tier)
        const voiceId = voice || 'FunAudioLLM/CosyVoice2-0.5B:alex';

        const ttsResponse = await fetch('https://api.siliconflow.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'FunAudioLLM/CosyVoice2-0.5B',
                input: fullText,
                voice: voiceId,
                response_format: 'pcm',
                sample_rate: 32000,
                stream: false
            }),
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            console.error('SiliconFlow TTS error:', errorText);
            return new Response(JSON.stringify({ error: 'TTS request failed' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 4. Return audio + text
        // SiliconFlow returns raw binary audio data
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

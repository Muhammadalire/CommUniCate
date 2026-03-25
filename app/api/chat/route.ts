import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const { messages, systemInstruction, voice } = await req.json();

        // 1. Get LLM response from Mimo (non-streaming for reliability)
        const mimoChatResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'api-key': process.env.MIMO_API_KEY || '',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'mimo-v2-pro',
                messages: [
                    { role: 'system', content: systemInstruction },
                    ...messages,
                ],
                max_completion_tokens: 300,
                temperature: 0.8,
                stream: false,
                thinking: { type: 'disabled' },
            })
        });

        if (!mimoChatResponse.ok) {
            const err = await mimoChatResponse.text();
            console.error('Mimo Chat Error:', err);
            return new Response(JSON.stringify({ error: 'Mimo LLM request failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        const chatData = await mimoChatResponse.json();
        console.log('Mimo Chat Response:', JSON.stringify(chatData).substring(0, 500));
        const fullText = chatData.choices?.[0]?.message?.content || '';

        if (!fullText.trim()) {
            return new Response(JSON.stringify({ error: 'Empty LLM response from Mimo' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let audioBase64 = '';
        const voiceId = voice || 'mimo-v2-tts:mimo_default';

        if (voiceId.startsWith('mimo')) {
            // 3a. Send text to Mimo TTS
            const voiceName = voiceId.split(':')[1] || 'mimo_default';
            const ttsResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'api-key': process.env.MIMO_API_KEY || '',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'mimo-v2-tts',
                    messages: [
                        { role: 'user', content: 'Please read this aloud.' },
                        { role: 'assistant', content: fullText }
                    ],
                    audio: {
                        format: 'wav',
                        voice: voiceName
                    }
                }),
            });

            if (!ttsResponse.ok) {
                const errorText = await ttsResponse.text();
                console.error('Mimo TTS error:', errorText);
                return new Response(JSON.stringify({ error: 'Mimo TTS request failed' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            const ttsData = await ttsResponse.json();
            console.log('Mimo TTS Response keys:', JSON.stringify(Object.keys(ttsData)));
            console.log('Mimo TTS Response (truncated):', JSON.stringify(ttsData).substring(0, 500));
            // Extract audio from Mimo TTS response - check multiple possible locations
            if (ttsData.choices?.[0]?.message?.audio?.data) {
                audioBase64 = ttsData.choices[0].message.audio.data;
            } else if (ttsData.audio?.data) {
                audioBase64 = ttsData.audio.data;
            } else {
                console.error('Mimo TTS: Could not find audio data in response');
            }
        } else {
            // 3b. Send text to SiliconFlow TTS (fallback for old voices)
            const fullVoiceId = voiceId;
            const colonIndex = fullVoiceId.indexOf(':');
            const ttsModel = colonIndex !== -1 ? fullVoiceId.substring(0, colonIndex) : 'IndexTeam/IndexTTS-2';
            const ttsVoice = colonIndex !== -1 ? fullVoiceId.substring(colonIndex + 1) : fullVoiceId;

            const sfResponse = await fetch('https://api.siliconflow.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: ttsModel,
                    input: fullText,
                    voice: fullVoiceId,
                    response_format: 'mp3',
                    stream: false
                }),
            });

            if (!sfResponse.ok) {
                console.error('SiliconFlow TTS error:', await sfResponse.text());
                 return new Response(JSON.stringify({ error: 'SiliconFlow TTS failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
            const audioBuffer = await sfResponse.arrayBuffer();
            audioBase64 = Buffer.from(audioBuffer).toString('base64');
        }

        // 4. Return audio + text
        return new Response(
            JSON.stringify({
                text: fullText,
                audio: audioBase64,
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error: any) {
        console.error('API chat error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

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
            const rawVoiceName = voiceId.split(':')[1] || 'mimo_default';

            // Map custom style IDs to natural language style descriptions.
            // The description goes in the user message as a style instruction.
            // The voice parameter must be one of: mimo_default, default_zh, default_en.
            const customStyleMap: Record<string, string> = {
                'mimo_soft_young_male':
                    'A "whisper-adjacent" male voice. Very high breathiness, low vocal effort. Speak as if inches away from a microphone. Naturally includes subtle [lip_smack] and [breath] cues between sentences. Words ending in vowels should trail off slightly... like this...',
                'mimo_passionate_young_male':
                    'High-energy, "bright" tenor male. Fast onset of words with crisp plosives (p, t, k). Use dynamic volume shifts—louder on key verbs. Naturally includes (chuckles) when delivering positive news and quick [sharp_inhale] before long explanations to show excitement.'
            };

            const isCustomStyle = rawVoiceName in customStyleMap;
            const userPrompt = isCustomStyle
                ? customStyleMap[rawVoiceName]
                : 'Please read this aloud.';
            // Custom styles use mimo_default as the base voice; standard voices pass through directly
            const ttsVoice = isCustomStyle ? 'mimo_default' : rawVoiceName;

            // Apply realism enhancements to the text
            const enhancedText = enhanceRealism(fullText);

            const ttsResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'api-key': process.env.MIMO_API_KEY || '',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'mimo-v2-tts',
                    messages: [
                        { role: 'user', content: userPrompt },
                        { role: 'assistant', content: enhancedText }
                    ],
                    audio: {
                        format: 'wav',
                        voice: ttsVoice
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
function enhanceRealism(text: string): string {
    // Randomly adds a breath or a "thinking" pause if the sentence is long
    if (text.length > 50 && !text.includes('[')) {
        return `[breath] ${text.replace('. ', '. [pause] ')}`;
    }

    // Add a natural reaction based on keywords
    return text
        .replace(/wait/gi, "Wait... [sharp_inhale]")
        .replace(/sorry/gi, "[sigh] sorry")
        .replace(/haha|lol/gi, "(chuckles)");
}

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

        const arrayBuffer = await file.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString('base64');
        const dataUri = `data:audio/webm;base64,${base64Audio}`;

        const mimoResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'api-key': process.env.MIMO_API_KEY || '',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'mimo-v2-omni',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a transcription assistant. Only transcribe the user\'s audio input word-for-word.'
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_audio',
                                input_audio: {
                                    data: dataUri
                                }
                            },
                            {
                                type: 'text',
                                text: 'Please transcribe the content of this audio accurately.'
                            }
                        ]
                    }
                ],
                max_completion_tokens: 1024
            })
        });

        if (!mimoResponse.ok) {
            const err = await mimoResponse.text();
            console.error('Mimo STT Error:', err);
            return NextResponse.json({ error: 'Mimo transcription failed' }, { status: 500 });
        }

        const data = await mimoResponse.json();
        const textStr = data.choices?.[0]?.message?.content || '';

        return NextResponse.json({ text: textStr });
    } catch (error: any) {
        console.error('Transcription error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}

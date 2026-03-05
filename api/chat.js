import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.API_KEY);
    const { prompt, systemPrompt, model } = req.body;

    const genModel = genAI.getGenerativeModel({
      model: model || 'gemini-2.0-flash',
      systemInstruction: systemPrompt || undefined,
    });

    const result = await genModel.generateContent(prompt);
    const text = result.response.text();

    res.status(200).json({ text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

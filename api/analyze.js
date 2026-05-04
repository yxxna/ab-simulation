// Vercel Serverless Function — Claude Vision API 분석
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageA, imageB } = req.body;
  if (!imageA || !imageB) return res.status(400).json({ error: '이미지가 필요합니다' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `당신은 UI/UX 전문가입니다. 두 UI 디자인 이미지를 비교해주세요.
첫 번째 이미지는 A안, 두 번째는 B안입니다.

아래 5가지 항목을 각각 0~100점으로 평가하고 JSON으로만 응답하세요. 설명 텍스트 없이 JSON만 출력하세요.

{
  "winner": "A" 또는 "B",
  "reason": "승자 선정 핵심 이유 한 문장",
  "scores": {
    "A": { "contrast": 0~100, "cta": 0~100, "hierarchy": 0~100, "density": 0~100, "polish": 0~100 },
    "B": { "contrast": 0~100, "cta": 0~100, "hierarchy": 0~100, "density": 0~100, "polish": 0~100 }
  },
  "feedback": {
    "A": "A안 강점과 약점 2문장",
    "B": "B안 강점과 약점 2문장"
  },
  "tip": "CTR을 높이기 위한 구체적 개선 제안 1가지"
}

평가 기준:
- contrast: 색상 대비와 가독성
- cta: CTA 요소의 시각적 강조도
- hierarchy: 시각적 위계 명확성
- density: 레이아웃 밀도 최적도
- polish: 전반적 디자인 완성도`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageA } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageB } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'JSON 파싱 실패', raw: text });

    res.status(200).json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

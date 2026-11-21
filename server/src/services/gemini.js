const { GoogleGenerativeAI } = require('@google/generative-ai');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return client;
}

/**
 * rewriteWithGemini(content, instruction)
 *
 * Sends the document content + instruction to Gemini and returns
 * the rewritten text as a plain string.
 *
 * The prompt is engineered to return ONLY the rewritten text with
 * no markdown fences, no explanation, no preamble — so we can diff
 * it directly against the original.
 */
async function rewriteWithGemini(content, instruction) {
  const model = getClient().getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are a document editor assistant. The user has given you a document and an instruction.

INSTRUCTION: ${instruction}

DOCUMENT:
${content}

Rewrite the document following the instruction exactly.
Return ONLY the rewritten document text.
Do NOT include any explanation, preamble, markdown code fences, or commentary.
Do NOT wrap the output in quotes or backticks.
Just return the final document text and nothing else.`;

  const result = await model.generateContent(prompt);
  const text   = result.response.text().trim();

  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

module.exports = { rewriteWithGemini };

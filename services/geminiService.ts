
import { GoogleGenAI, Type } from "@google/genai";
import { StructuredExperience, Diagnosis, ResumeData, FitCheckResult, Language } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const MODEL_NAME = "gemini-3-pro-preview";

const SYSTEM_PROMPT = `
ROLE & OBJECTIVE:
You are a cold, result-oriented recruitment expert. 
Your primary goal is to maximize the chances of a resume passing both ATS and human review.

GLOBAL STRICT RULES:
- LANGUAGE: You MUST output ALL content (resume markdown, critiques, labels, suggestions, reasons) in the language specified: [LANG]. 
- IDENTITY INTEGRITY: IMPORTANT! Preserve existing personal contact information (Name, Phone, Email) from the input. DO NOT remove, anonymize, or replace it with fake names. If it is completely missing, use placeholders like "[姓名/NAME]", "[电话/PHONE]".
- NEVER fabricate, invent, or exaggerate any experience.
- NEVER flatter. Output must be cold, precise, and metric-driven.
- SINGLE PAGE RESUME ONLY (Strict A4 constraint).
- FORMAT: Use standard Markdown. No fluff headers.
`;

function getLangString(lang: Language) {
  return lang === 'zh' ? 'Chinese (简体中文)' : 'English';
}

export async function structureExperience(
  rawText: string, 
  lang: Language,
  fileData?: { data: string; mimeType: string }
): Promise<StructuredExperience> {
  const parts: any[] = [{ text: `
      [LANGUAGE]: ${getLangString(lang)}.
      CRITICAL: ALL text in your JSON response MUST be in ${getLangString(lang)}.
      Task: Process this professional brain dump into clean structured sections.
      Input: ${rawText}
    ` }];

  if (fileData) {
    const base64Data = fileData.data.includes(',') ? fileData.data.split(',')[1] : fileData.data;
    parts.push({
      inlineData: {
        data: base64Data,
        mimeType: fileData.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_PROMPT.replace('[LANG]', getLangString(lang)),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          traits: { type: Type.ARRAY, items: { type: Type.STRING } },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                items: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["title", "items"]
            }
          }
        },
        required: ["traits", "sections"]
      }
    }
  });

  return JSON.parse(response.text || "{}") as StructuredExperience;
}

export async function performFitCheck(experience: StructuredExperience, jd: string, lang: Language): Promise<FitCheckResult> {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
      [LANGUAGE]: ${getLangString(lang)}.
      CRITICAL: ALL text in your JSON response MUST be in ${getLangString(lang)}.
      Compare DNA vs JD. 
      Professional DNA: ${JSON.stringify(experience)}
      Target JD: ${jd}
    `,
    config: {
      systemInstruction: SYSTEM_PROMPT.replace('[LANG]', getLangString(lang)),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          comparisonTable: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                requirement: { type: Type.STRING },
                evidence: { type: Type.STRING },
                match: { type: Type.STRING, enum: ['high', 'mid', 'low'] }
              },
              required: ["requirement", "evidence", "match"]
            }
          },
          whyMatch: { type: Type.ARRAY, items: { type: Type.STRING } },
          gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          conclusion: { type: Type.STRING, enum: ['Go for it', 'Stretch goal', 'Pivot needed'] },
          alternativeRoles: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["score", "comparisonTable", "whyMatch", "gaps", "conclusion"]
      }
    }
  });

  return JSON.parse(response.text || "{}") as FitCheckResult;
}

export async function generateResumeDraft(experience: StructuredExperience, jd: string, lang: Language, isFinal: boolean = false): Promise<{resume: ResumeData, diagnosis: Diagnosis}> {
  const prompt = isFinal 
    ? "Task: Generate the FINAL CLEAN resume. CRITICAL: DO NOT include any 'Matching tags', 'Alignment notes', or strings like '匹配：', 'Match:', or '<span class=\"match-tag\">'. Output a pure, professional Markdown resume ready to be sent to a recruiter. Remove all internal diagnostic hints. Preserve identity info."
    : `Task: Generate an ANNOTATED resume for internal review. 
       For each major point or skill, append a small tag like '<span class="match-tag">Match: [Keyword]</span>' to show how it aligns with the JD. 
       Include a brutal diagnosis of weaknesses. Preserving identity info.`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `
      [LANGUAGE]: ${getLangString(lang)}.
      CRITICAL: ALL text in your JSON response (resume content and reasons) MUST be in ${getLangString(lang)}.
      JD for alignment: ${jd}
      Experience DNA: ${JSON.stringify(experience)}
      ${prompt}
    `,
    config: {
      systemInstruction: SYSTEM_PROMPT.replace('[LANG]', getLangString(lang)),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          resume: {
            type: Type.OBJECT,
            properties: { content: { type: Type.STRING } },
            required: ["content"]
          },
          diagnosis: {
            type: Type.OBJECT,
            properties: {
              reasons: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    action: { type: Type.STRING },
                    severity: { type: Type.STRING, enum: ['critical', 'major', 'minor'] }
                  },
                  required: ["title", "description", "action", "severity"]
                }
              }
            },
            required: ["reasons"]
          }
        },
        required: ["resume", "diagnosis"]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return { resume: result.resume, diagnosis: result.diagnosis };
}

export async function refineResume(currentResume: string, experience: StructuredExperience, jd: string, feedback: string, lang: Language): Promise<{resume: ResumeData, diagnosis: Diagnosis}> {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `
      [LANGUAGE]: ${getLangString(lang)}.
      Iterate based on feedback: ${feedback}
      Current Resume: ${currentResume}
      DNA: ${JSON.stringify(experience)}
      JD: ${jd}
      Maintain the annotated format with '<span class="match-tag">Match: ...</span>' tags if they currently exist.
    `,
    config: {
      systemInstruction: SYSTEM_PROMPT.replace('[LANG]', getLangString(lang)),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          resume: {
            type: Type.OBJECT,
            properties: { content: { type: Type.STRING } },
            required: ["content"]
          },
          diagnosis: {
            type: Type.OBJECT,
            properties: {
              reasons: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    action: { type: Type.STRING },
                    severity: { type: Type.STRING, enum: ['critical', 'major', 'minor'] }
                  },
                  required: ["title", "description", "action", "severity"]
                }
              }
            },
            required: ["reasons"]
          }
        },
        required: ["resume", "diagnosis"]
      }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return { resume: result.resume, diagnosis: result.diagnosis };
}

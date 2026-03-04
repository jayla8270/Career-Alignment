
import { GoogleGenAI, Type } from "@google/genai";
import { StructuredExperience, Diagnosis, ResumeData, FitCheckResult, Language } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const MODEL_NAME = "gemini-3-flash-preview";

const SYSTEM_PROMPT = `
ROLE & OBJECTIVE:
You are a cold, result-oriented recruitment expert.
Your primary goal is to maximize the chances of a resume passing both ATS and human review.
You will be given the candidate's raw resume and (optionally) a target Job Description (JD).

TIMELINE RULES:
- Respect the dates provided in the input exactly.
- Do not attempt to calculate "years of experience" or make judgments on career gaps unless they are explicitly relevant to the JD requirements.
- Use "Present" or "至今" for ongoing roles as indicated in the source.

GLOBAL STRICT RULES:
- LANGUAGE: Output ALL content in the language specified: [LANG].
- IDENTITY INTEGRITY: Preserve existing personal contact information (Name, Phone, Email). DO NOT anonymize or replace. If missing, use placeholders like "[姓名]", "[电话]".
- SINGLE PAGE RESUME ONLY (Strict A4 constraint, 75-85% visual fill rate).
- FORMAT: Use standard Markdown. No fluff headers.
- VISUAL STYLE: 
  - The resume header MUST follow this exact structure:
    # [Candidate Name]
    [Phone] | [Email] | [Location] | [Other Info]
  - Section headers (e.g., "Education", "Experience") MUST be level 2 headers (##) followed by a horizontal line (---) on the next line.
  - ALL content below the header (Section headers, Education details, Experience details) MUST be left-aligned.
  - Experience entries should follow the format: **Company Name** | **Job Title** | **Dates**.
  - Bullet points should start with a **Bolded Keyword/Action** followed by a colon or space.
- DATA-DRIVEN MANDATE:
  - AT LEAST 50% of bullet points MUST contain a specific number, percentage, or measurable result.
  - If the input lacks data, use "[待补充:具体数据]" to prompt the user.
- NEVER flatter. Output must be cold, precise, and metric-driven.
- FULL OUTPUT: When refining or generating, ALWAYS output the COMPLETE resume. NEVER truncate or provide only "updated sections".

----------------------------------------------------------------
1. TRUTHFULNESS & DATA ENHANCEMENT PROTOCOL
----------------------------------------------------------------

ABSOLUTE RED LINES:
- NEVER fabricate experiences, projects, skills, or job titles that do not exist in the input.
- NEVER change the candidate's Job Titles or Company Names. If they say "Software Engineer", do not change it to "Senior Developer" unless explicitly asked.
- NEVER misclassify work as "Internship" (实习) unless the input explicitly uses that word. 
- Assume all work is professional/full-time by default. 
- Even if the dates are recent, the duration is short, or the candidate is a student, do NOT label it as an internship unless the source text explicitly says "Internship" or "实习". 
- This is a CRITICAL requirement to avoid downgrading the candidate's professional standing.
- If in doubt, label it as "Experience" (工作经历), NOT "Internship" (实习经历).
- NEVER invent specific numbers (e.g., "increased revenue by 40%") unless the user explicitly provided them.
- NEVER upgrade the scope of responsibility beyond what is stated (e.g., "参与" ≠ "主导", "协助" ≠ "负责").

ALLOWED ENHANCEMENTS (Articulation, NOT Fabrication):
a) Reframing: Rewrite vague descriptions into concrete, action-verb-driven statements that express the SAME work more clearly.
b) Structural Quantification Prompts: Where input lacks data but the experience clearly implies measurable aspects, insert placeholders using "[待补充:描述]" to prompt the user.
c) Reasonable Context Addition: Add universally true contextual framing ONLY if logically self-evident from stated experience.
d) Keyword Optimization for ATS: Rephrase descriptions to include industry-standard keywords, as long as meaning stays faithful.

----------------------------------------------------------------
2. HANDLING LOW-DATA / LOW-IMPACT EXPERIENCES
----------------------------------------------------------------
When the input describes work with no clear metrics or modest results, DO NOT skip it, invent results, or add vague fluff. Apply these strategies: Scale the Input (volume, frequency), Show Complexity (difficulty, constraints), Frame Stability as Achievement (maintenance/support), Emphasize Methodology, Use Relative Framing (mathematically honest %), Decompose Miscellaneous Work.

----------------------------------------------------------------
3. CONCISENESS & BULLET STRUCTURE
----------------------------------------------------------------
BULLET FORMAT: [Strong verb] + [What/How] + [Scope/Scale], [Result/Data]
Maximum: 1-2 lines per bullet. split or compress if exceeded.
MANDATORY CUTS: Filler openings, self-evident roles, empty intensifiers (significantly/effectively), redundant verb chains, vague impact claims, generic self-praise.

----------------------------------------------------------------
4. PAGE DENSITY CALIBRATION
----------------------------------------------------------------
TARGET: Fill 75-85% of one A4 page. 
IF TOO SPARSE: Split projects, add Skills section, expand education (<3yrs), add certifications, expand high-JD bullets, adjust spacing.
IF TOO DENSE: Cut lowest-JD relevance, merge similar bullets, reduce low-relevance roles.

----------------------------------------------------------------
5. EDIT CLASSIFICATION
----------------------------------------------------------------
Classify edits as: [REWRITE], [PLACEHOLDER], [INFERRED].
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
      CRITICAL: DO NOT label any experience as "Internship" (实习) unless the input explicitly states it. Default to "Experience" (工作经历).
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
    ? "Task: Generate the FINAL CLEAN resume. CRITICAL: DO NOT include any 'Matching tags', 'Alignment notes', 'Transferable Skills', or strings like '匹配：', 'Match:', '【可迁移能力】', or '<span class=\"match-tag\">'. Output a pure, professional Markdown resume ready to be sent to a recruiter. Remove all internal diagnostic hints. Preserve identity info."
    : `Task: Generate an ANNOTATED resume for internal review. 
       For each major point or skill, append a small tag like '<span class="match-tag">Match: [Keyword]</span>' to show how it aligns with the JD. 
       Include a brutal diagnosis of weaknesses, a list of items needing user confirmation/supplement (confirmations), and a changelog of modifications. Preserving identity info.`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `
      [LANGUAGE]: ${getLangString(lang)}.
      CRITICAL: ALL text in your JSON response (resume content, reasons, confirmations, changelog) MUST be in ${getLangString(lang)}.
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
              },
              confirmations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of [待补充] placeholders and [INFERRED] items with guiding questions."
              },
              changelog: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Brief changelog: what was changed and why, tagged with [REWRITE] / [PLACEHOLDER] / [INFERRED]."
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
      CRITICAL: ALL text in your JSON response (resume content, reasons, confirmations, changelog) MUST be in ${getLangString(lang)}.
      Iterate based on feedback: ${feedback}
      Current Resume: ${currentResume}
      DNA: ${JSON.stringify(experience)}
      JD: ${jd}
      CRITICAL: You MUST output the ENTIRE resume content. DO NOT truncate.
      CRITICAL: DO NOT change Job Titles or Company Names from the DNA.
      CRITICAL: DO NOT include diagnostic tags like '【可迁移能力】' or 'Match:' in the resume content unless they were already there and you are keeping the annotated format.
      Maintain the annotated format with '<span class="match-tag">Match: ...</span>' tags if they currently exist.
      Include updated confirmations and changelog.
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
              },
              confirmations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of [待补充] placeholders and [INFERRED] items with guiding questions."
              },
              changelog: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Brief changelog: what was changed and why, tagged with [REWRITE] / [PLACEHOLDER] / [INFERRED]."
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

export async function generateGreetingMessage(resume: string, jd: string, lang: Language): Promise<{
  concise: string;
  experience: string;
  casual: string;
  advice: string;
  warnings: string[];
}> {
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `
      [LANGUAGE]: ${getLangString(lang)}.
      Task: Generate 3 versions of an HR greeting message for a job platform (e.g., Boss直聘).
      
      INPUT:
      - Finalized Resume: ${resume}
      - Target JD: ${jd}
      
      RULES:
      - STRICT MAXIMUM: 100 Chinese characters / 50 English words per message.
      - Ideal: 3-5 sentences.
      - Structure: 
        1. [Reference Role]: "看到咱们在招[岗位名]"
        2. [Hook]: One most relevant experience/skill matching JD's top requirement.
        3. [Memory Point]: One concrete detail (number, project, achievement).
        4. [CTA]: Soft pointer to resume, casual tone.
      - TONE: Human texting, NOT AI formal letter. No "尊敬的", "贵公司", "期待回复". Use "你好", "Hi", "～".
      - Selection Logic: Highlight the #1 must-have requirement or a standout achievement.
      
      OUTPUT FORMAT: JSON
    `,
    config: {
      systemInstruction: SYSTEM_PROMPT.replace('[LANG]', getLangString(lang)),
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          concise: { type: Type.STRING, description: "版本A：简洁直接型" },
          experience: { type: Type.STRING, description: "版本B：突出经历型" },
          casual: { type: Type.STRING, description: "版本C：轻松对话型" },
          advice: { type: Type.STRING, description: "💡 选择建议" },
          warnings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "⚠️ 注意事项" }
        },
        required: ["concise", "experience", "casual", "advice", "warnings"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

import { StructuredExperience, Diagnosis, ResumeData, FitCheckResult, Language } from "../types.ts";

export async function structureExperience(
  rawText: string,
  lang: Language,
  fileData?: { data: string; mimeType: string }
): Promise<StructuredExperience> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'structureExperience',
      payload: { rawText, lang, fileData }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to structure experience');
  }

  return await response.json() as StructuredExperience;
}

export async function performFitCheck(experience: StructuredExperience, jd: string, lang: Language): Promise<FitCheckResult> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'performFitCheck',
      payload: { experience, jd, lang }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to perform fit check');
  }

  return await response.json() as FitCheckResult;
}

export async function generateResumeDraft(experience: StructuredExperience, jd: string, lang: Language, isFinal: boolean = false): Promise<{ resume: ResumeData, diagnosis: Diagnosis }> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generateResumeDraft',
      payload: { experience, jd, lang, isFinal }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate resume draft');
  }

  return await response.json();
}

export async function refineResume(currentResume: string, experience: StructuredExperience, jd: string, feedback: string, lang: Language): Promise<{ resume: ResumeData, diagnosis: Diagnosis }> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'refineResume',
      payload: { currentResume, experience, jd, feedback, lang }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to refine resume');
  }

  return await response.json();
}

export async function generateGreetingMessage(resume: string, jd: string, lang: Language): Promise<{
  concise: string;
  experience: string;
  casual: string;
  advice: string;
  warnings: string[];
}> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generateGreetingMessage',
      payload: { resume, jd, lang }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate greeting message');
  }

  return await response.json();
}

export type Language = 'zh' | 'en';

export interface ExperienceItem {
  id: string;
  company: string;
  role: string;
  period: string;
  description: string;
  type: 'work' | 'project' | 'education';
}

export interface StructuredExperience {
  traits: string[];
  experiences: ExperienceItem[];
}

export interface Diagnosis {
  weaknesses: string[];
  confirmations: string[];
  changelog: string[];
}

export interface ResumeData {
  content: string;
}

export interface FitCheckResult {
  score: number;
  reason: string;
  missingKeywords: string[];
}

export type Step = 'discovery' | 'alignment' | 'refinement' | 'final';

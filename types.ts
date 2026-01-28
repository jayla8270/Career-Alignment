
export enum Step {
  DISCOVERY = 1,
  FIT_CHECK = 2,
  DIAGNOSIS = 3,
  POLISH = 4
}

export type Language = 'en' | 'zh';

export interface StructuredExperience {
  sections: {
    title: string;
    items: string[];
  }[];
  traits: string[];
}

export interface FitCheckResult {
  score: number;
  comparisonTable: {
    requirement: string;
    evidence: string;
    match: 'high' | 'mid' | 'low';
  }[];
  whyMatch: string[];
  gaps: string[];
  conclusion: 'Go for it' | 'Stretch goal' | 'Pivot needed';
  alternativeRoles?: string[];
}

export interface Critique {
  title: string;
  description: string;
  action: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface Diagnosis {
  reasons: Critique[];
}

export interface ResumeData {
  content: string; // Markdown format
}

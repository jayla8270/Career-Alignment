
export enum Step {
  DISCOVERY = 1,
  FIT_CHECK = 2,
  DIAGNOSIS = 3,
  POLISH = 4,
  GREETING = 5,
}

export type Language = 'zh' | 'en';

export interface StructuredExperience {
  traits: string[];
  sections: {
    title: string;
    items: string[];
  }[];
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

export interface ResumeData {
  content: string;
  greetings?: {
    concise: string;
    experience: string;
    casual: string;
    advice: string;
    warnings: string[];
  };
}

export interface Diagnosis {
  reasons: {
    title: string;
    description: string;
    action: string;
    severity: 'critical' | 'major' | 'minor';
  }[];
  confirmations: string[];
  changelog: string[];
}

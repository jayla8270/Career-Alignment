
export enum Step {
  DISCOVERY = 1,
  FIT_CHECK = 2,
  DIAGNOSIS = 3,
  POLISH = 4,
  GREETING = 5
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
  confirmations?: string[]; // Part 2: Items needing user confirmation/supplement
  changelog?: string[];     // Part 3: Modification explanation
}

export interface ResumeData {
  content: string; // Markdown format
  greetings?: {
    concise: string;
    experience: string;
    casual: string;
    advice: string;
    warnings: string[];
  };
}

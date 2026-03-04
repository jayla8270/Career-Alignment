
import React from 'react';
import { Step, Language } from '../types';

interface StepIndicatorProps {
  currentStep: Step;
  onStepClick: (step: Step) => void;
  availableSteps: Step[];
  lang: Language;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep, onStepClick, availableSteps, lang }) => {
  const steps = [
    { id: Step.DISCOVERY, name: lang === 'zh' ? '发现 DNA' : 'Discovery' },
    { id: Step.FIT_CHECK, name: lang === 'zh' ? '匹配检查' : 'Fit Check' },
    { id: Step.DIAGNOSIS, name: lang === 'zh' ? '简历诊断' : 'Brutal Review' },
    { id: Step.POLISH, name: lang === 'zh' ? '最终打磨' : 'Final Polish' },
  ];

  return (
    <div className="flex items-center justify-between w-full max-w-4xl mx-auto px-4 py-8">
      {steps.map((step, idx) => {
        const isAvailable = availableSteps.includes(step.id);
        const isActive = currentStep === step.id;
        const isCompleted = currentStep > step.id;

        return (
          <React.Fragment key={step.id}>
            <button 
              onClick={() => isAvailable && onStepClick(step.id)}
              disabled={!isAvailable}
              className={`flex flex-col items-center group outline-none transition-all ${isAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300
                ${isActive ? 'bg-zinc-900 text-white shadow-lg ring-4 ring-zinc-100' : 
                  isCompleted ? 'bg-zinc-300 text-white' : 'bg-white border-2 border-zinc-200 text-zinc-400'}
                ${isAvailable && !isActive ? 'hover:border-zinc-900 hover:text-zinc-900' : ''}
              `}>
                {isCompleted ? '✓' : step.id}
              </div>
              <span className={`mt-2 text-[9px] font-black uppercase tracking-widest ${isActive ? 'text-zinc-900' : 'text-zinc-300'}`}>
                {step.name}
              </span>
            </button>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-[1px] mx-2 transition-colors duration-500 ${isCompleted ? 'bg-zinc-300' : 'bg-zinc-100'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

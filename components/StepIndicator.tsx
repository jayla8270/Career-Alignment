
import React from 'react';
import { Step } from '../types';

interface StepIndicatorProps {
  currentStep: Step;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
  const steps = [
    { id: Step.DISCOVERY, name: 'Discovery' },
    { id: Step.FIT_CHECK, name: 'Fit Check' },
    { id: Step.DIAGNOSIS, name: 'Brutal Review' },
    { id: Step.POLISH, name: 'Final Polish' },
  ];

  return (
    <div className="flex items-center justify-between w-full max-w-4xl mx-auto px-4 py-8">
      {steps.map((step, idx) => (
        <React.Fragment key={step.id}>
          <div className="flex flex-col items-center group">
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300
              ${currentStep === step.id ? 'bg-zinc-900 text-white shadow-lg ring-4 ring-zinc-100' : 
                currentStep > step.id ? 'bg-zinc-300 text-white' : 'bg-white border-2 border-zinc-200 text-zinc-400'}
            `}>
              {currentStep > step.id ? '✓' : step.id}
            </div>
            <span className={`mt-2 text-[9px] font-black uppercase tracking-widest ${currentStep === step.id ? 'text-zinc-900' : 'text-zinc-300'}`}>
              {step.name}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`flex-1 h-[1px] mx-2 transition-colors duration-500 ${currentStep > step.id ? 'bg-zinc-300' : 'bg-zinc-100'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

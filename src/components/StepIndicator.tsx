import React from 'react';
import { Step } from '../types';
import { Check, Circle } from 'lucide-react';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StepIndicatorProps {
  currentStep: Step;
}

const STEPS: { id: Step; label: string; description: string }[] = [
  { id: 'discovery', label: '发现 DNA', description: '提取核心职业特质' },
  { id: 'alignment', label: '岗位对齐', description: '匹配目标职位需求' },
  { id: 'refinement', label: '精炼打磨', description: '针对性优化简历' },
  { id: 'final', label: '最终成品', description: '导出 ATS 友好简历' },
];

export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full py-8">
      <div className="flex items-center justify-between max-w-4xl mx-auto px-4">
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isActive = index === currentIndex;

          return (
            <div key={step.id} className="flex flex-col items-center relative flex-1">
              {/* Line */}
              {index !== 0 && (
                <div
                  className={cn(
                    "absolute top-5 right-1/2 w-full h-[2px] -z-10",
                    isCompleted || isActive ? "bg-zinc-900" : "bg-zinc-200"
                  )}
                />
              )}

              {/* Icon */}
              <motion.div
                initial={false}
                animate={{
                  scale: isActive ? 1.1 : 1,
                  backgroundColor: isActive || isCompleted ? "#18181b" : "#f4f4f5",
                  color: isActive || isCompleted ? "#ffffff" : "#71717a",
                }}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                  isActive ? "border-zinc-900 shadow-lg" : isCompleted ? "border-zinc-900" : "border-zinc-200"
                )}
              >
                {isCompleted ? <Check size={20} /> : <span>{index + 1}</span>}
              </motion.div>

              {/* Label */}
              <div className="mt-3 text-center">
                <p className={cn("text-sm font-semibold", isActive ? "text-zinc-900" : "text-zinc-500")}>
                  {step.label}
                </p>
                <p className="text-[10px] text-zinc-400 hidden sm:block">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

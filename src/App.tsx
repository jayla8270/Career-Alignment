import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Brain, 
  Target, 
  Sparkles, 
  FileCheck, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Plus,
  Trash2,
  Save,
  Edit2,
  Download,
  Languages
} from 'lucide-react';
import Markdown from 'react-markdown';
import { StepIndicator } from './components/StepIndicator';
import { 
  Step, 
  StructuredExperience, 
  Diagnosis, 
  ResumeData, 
  FitCheckResult, 
  Language,
  ExperienceItem
} from './types';
import { 
  discoverExperience, 
  checkAlignment, 
  generateResumeDraft, 
  refineResume 
} from './services/geminiService';

const App: React.FC = () => {
  const [step, setStep] = useState<Step>('discovery');
  const [lang, setLang] = useState<Language>('zh');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data State
  const [rawExperience, setRawExperience] = useState('');
  const [dna, setDna] = useState<StructuredExperience | null>(null);
  const [isEditingDna, setIsEditingDna] = useState(false);
  const [jd, setJd] = useState('');
  const [alignment, setAlignment] = useState<FitCheckResult | null>(null);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [feedback, setFeedback] = useState('');

  // Handlers
  const handleDiscovery = async () => {
    if (!rawExperience.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await discoverExperience(rawExperience, lang);
      setDna(result);
      setStep('alignment');
    } catch (err) {
      setError('解析 DNA 失败，请重试');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAlignment = async () => {
    if (!jd.trim() || !dna) return;
    setLoading(true);
    setError(null);
    try {
      const fit = await checkAlignment(dna, jd, lang);
      setAlignment(fit);
      
      const { resume: draft, diagnosis: diag } = await generateResumeDraft(dna, jd, lang);
      setResume(draft);
      setDiagnosis(diag);
      setStep('refinement');
    } catch (err) {
      setError('岗位对齐失败，请检查输入');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!feedback.trim() || !resume || !dna) return;
    setLoading(true);
    setError(null);
    try {
      const { resume: updated, diagnosis: diag } = await refineResume(dna, jd, resume.content, feedback, lang);
      setResume(updated);
      setDiagnosis(diag);
      setFeedback('');
    } catch (err) {
      setError('优化失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!dna || !jd) return;
    setLoading(true);
    setError(null);
    try {
      const { resume: final } = await generateResumeDraft(dna, jd, lang, true);
      setResume(final);
      setStep('final');
    } catch (err) {
      setError('生成最终版本失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDnaChange = (field: keyof StructuredExperience, value: any) => {
    if (!dna) return;
    setDna({ ...dna, [field]: value });
  };

  const handleExperienceChange = (id: string, field: keyof ExperienceItem, value: string) => {
    if (!dna) return;
    const updated = dna.experiences.map(exp => exp.id === id ? { ...exp, [field]: value } : exp);
    setDna({ ...dna, experiences: updated });
  };

  const addExperience = () => {
    if (!dna) return;
    const newItem: ExperienceItem = {
      id: Math.random().toString(36).substr(2, 9),
      company: '新公司',
      role: '职位名称',
      period: '202X - 至今',
      description: '描述你的职责和成就...',
      type: 'work'
    };
    setDna({ ...dna, experiences: [newItem, ...dna.experiences] });
  };

  const removeExperience = (id: string) => {
    if (!dna) return;
    setDna({ ...dna, experiences: dna.experiences.filter(e => e.id !== id) });
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-white">
              <Sparkles size={18} />
            </div>
            <h1 className="text-lg font-bold tracking-tight">Career Alignment AI</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors px-3 py-1.5 rounded-full bg-zinc-100"
            >
              <Languages size={14} />
              {lang === 'zh' ? '中文' : 'English'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-24">
        <StepIndicator currentStep={step} />

        <AnimatePresence mode="wait">
          {/* Step 1: Discovery */}
          {step === 'discovery' && (
            <motion.div
              key="discovery"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="bg-white rounded-2xl border border-zinc-200 p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-zinc-100 rounded-lg">
                    <Brain className="text-zinc-900" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">发现你的职业 DNA</h2>
                    <p className="text-sm text-zinc-500">粘贴你的原始简历或经历描述，AI 将提取核心特质。</p>
                  </div>
                </div>

                <textarea
                  value={rawExperience}
                  onChange={(e) => setRawExperience(e.target.value)}
                  placeholder="在这里粘贴你的简历内容或工作经历描述..."
                  className="w-full h-64 p-4 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all resize-none text-sm leading-relaxed"
                />

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleDiscovery}
                    disabled={loading || !rawExperience.trim()}
                    className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <ChevronRight size={20} />}
                    开始解析
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Alignment */}
          {step === 'alignment' && (
            <motion.div
              key="alignment"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold flex items-center gap-2">
                      <Brain size={18} /> 职业 DNA
                    </h3>
                    <button 
                      onClick={() => setIsEditingDna(!isEditingDna)}
                      className="text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1"
                    >
                      {isEditingDna ? <Save size={14} /> : <Edit2 size={14} />}
                      {isEditingDna ? '完成' : '编辑'}
                    </button>
                  </div>
                  
                  {isEditingDna ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">核心特质</label>
                        <input 
                          value={dna?.traits.join(', ')}
                          onChange={(e) => handleDnaChange('traits', e.target.value.split(',').map(s => s.trim()))}
                          className="w-full p-2 text-sm border rounded-lg"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">经历板块</label>
                          <button onClick={addExperience} className="p-1 hover:bg-zinc-100 rounded text-zinc-500"><Plus size={14}/></button>
                        </div>
                        <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
                          {dna?.experiences.map(exp => (
                            <div key={exp.id} className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 relative group">
                              <button 
                                onClick={() => removeExperience(exp.id)}
                                className="absolute top-2 right-2 p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 size={12}/>
                              </button>
                              <input 
                                value={exp.role}
                                onChange={(e) => handleExperienceChange(exp.id, 'role', e.target.value)}
                                className="w-full bg-transparent font-bold text-xs mb-1 focus:outline-none"
                                placeholder="职位"
                              />
                              <input 
                                value={exp.company}
                                onChange={(e) => handleExperienceChange(exp.id, 'company', e.target.value)}
                                className="w-full bg-transparent text-[10px] text-zinc-500 mb-2 focus:outline-none"
                                placeholder="公司"
                              />
                              <textarea 
                                value={exp.description}
                                onChange={(e) => handleExperienceChange(exp.id, 'description', e.target.value)}
                                className="w-full bg-transparent text-[10px] leading-relaxed focus:outline-none resize-none"
                                rows={3}
                                placeholder="描述"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="flex flex-wrap gap-2">
                        {dna?.traits.map((trait, i) => (
                          <span key={i} className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md text-[10px] font-medium">
                            {trait}
                          </span>
                        ))}
                      </div>
                      <div className="space-y-4">
                        {dna?.experiences.map(exp => (
                          <div key={exp.id} className="border-l-2 border-zinc-100 pl-3 py-1">
                            <p className="text-xs font-bold">{exp.role}</p>
                            <p className="text-[10px] text-zinc-500">{exp.company} · {exp.period}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-white rounded-2xl border border-zinc-200 p-8 shadow-sm h-full">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-zinc-100 rounded-lg">
                      <Target className="text-zinc-900" size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">岗位对齐</h2>
                      <p className="text-sm text-zinc-500">粘贴目标岗位的 JD，AI 将分析匹配度并生成初稿。</p>
                    </div>
                  </div>

                  <textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="在这里粘贴目标岗位的职位描述 (JD)..."
                    className="w-full h-64 p-4 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all resize-none text-sm leading-relaxed"
                  />

                  <div className="mt-6 flex justify-between items-center">
                    <button
                      onClick={() => setStep('discovery')}
                      className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
                    >
                      返回上一步
                    </button>
                    <button
                      onClick={handleAlignment}
                      disabled={loading || !jd.trim()}
                      className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {loading ? <Loader2 className="animate-spin" size={20} /> : <ChevronRight size={20} />}
                      开始对齐
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Refinement */}
          {step === 'refinement' && (
            <motion.div
              key="refinement"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Diagnosis Sidebar */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm sticky top-24">
                  <h3 className="font-bold flex items-center gap-2 mb-4 text-zinc-900">
                    <AlertCircle size={18} className="text-amber-500" /> 简历诊断报告
                  </h3>
                  
                  <div className="space-y-6">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 mb-2">匹配得分</p>
                      <div className="flex items-end gap-2">
                        <span className="text-4xl font-black text-zinc-900">{alignment?.score}</span>
                        <span className="text-sm text-zinc-400 mb-1">/ 100</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 mb-2">核心弱点</p>
                        <ul className="space-y-2">
                          {diagnosis?.weaknesses.map((w, i) => (
                            <li key={i} className="text-xs text-zinc-600 flex gap-2">
                              <span className="text-zinc-300">•</span> {w}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 mb-2">待确认项</p>
                        <ul className="space-y-2">
                          {diagnosis?.confirmations.map((c, i) => (
                            <li key={i} className="text-xs text-zinc-600 flex gap-2">
                              <span className="text-amber-400">?</span> {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Resume Preview & Editor */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                  <div className="bg-zinc-900 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white">
                      <FileCheck size={18} />
                      <span className="text-sm font-bold">简历初稿 (已标注)</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[10px] bg-white/10 text-white/60 px-2 py-1 rounded">Markdown</span>
                    </div>
                  </div>
                  
                  <div className="p-10 bg-white min-h-[800px]">
                    <div className="markdown-body">
                      <Markdown>{resume?.content}</Markdown>
                    </div>
                  </div>

                  {/* Refinement Controls */}
                  <div className="p-8 border-t border-zinc-100 bg-zinc-50/50">
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-zinc-900">反馈与优化</h4>
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="例如：'强调我在项目 A 中的领导力' 或 '补充我的 Python 技能'..."
                        className="w-full p-4 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all resize-none text-sm"
                        rows={3}
                      />
                      <div className="flex justify-between items-center">
                        <button
                          onClick={handleRefine}
                          disabled={loading || !feedback.trim()}
                          className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 transition-all"
                        >
                          {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                          应用反馈并迭代
                        </button>
                        
                        <button
                          onClick={handleFinalize}
                          disabled={loading}
                          className="flex items-center gap-2 border border-zinc-900 text-zinc-900 px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-zinc-100 transition-all"
                        >
                          最终 ATS 抛光
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4: Final */}
          {step === 'final' && (
            <motion.div
              key="final"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden">
                <div className="bg-emerald-600 px-8 py-6 flex items-center justify-between text-white">
                  <div>
                    <h2 className="text-xl font-bold">最终成品已就绪</h2>
                    <p className="text-xs text-emerald-100 mt-1">已移除所有诊断标签，针对 ATS 进行了深度优化。</p>
                  </div>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                  >
                    <Download size={18} />
                    导出 PDF
                  </button>
                </div>

                <div className="p-12 bg-white">
                  <div className="markdown-body">
                    <Markdown>{resume?.content}</Markdown>
                  </div>
                </div>

                <div className="p-8 bg-zinc-50 border-t border-zinc-100 flex justify-center">
                  <button
                    onClick={() => setStep('discovery')}
                    className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
                  >
                    重新开始新简历
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Toast */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-8 right-8 bg-red-50 border border-red-200 p-4 rounded-xl shadow-lg flex items-center gap-3 text-red-700 max-w-md z-[100]"
          >
            <AlertCircle size={20} />
            <p className="text-sm font-medium">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
          </motion.div>
        )}
      </main>
    </div>
  );
};

export default App;

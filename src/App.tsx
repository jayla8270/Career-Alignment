
import React, { useState, useEffect, useRef } from 'react';
import { Step, StructuredExperience, Diagnosis, ResumeData, FitCheckResult, Language } from './types.ts';
import { StepIndicator } from './components/StepIndicator.tsx';
import * as aiService from './services/geminiService.ts';
import { GoogleGenAI, Modality } from '@google/genai';
import * as docx from 'docx';

// --- Audio Utils ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>(Step.DISCOVERY);
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<Language>('zh');
  const [isEditingResume, setIsEditingResume] = useState(false);
  const [isEditingDna, setIsEditingDna] = useState(false);
  
  const [rawExperience, setRawExperience] = useState('');
  const [uploadedFile, setUploadedFile] = useState<{ data: string; name: string; type: string } | null>(null);
  const [structuredExperience, setStructuredExperience] = useState<StructuredExperience | null>(null);
  const [jd, setJd] = useState('');
  const [fitCheck, setFitCheck] = useState<FitCheckResult | null>(null);
  const [resumeDraft, setResumeDraft] = useState<ResumeData | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [refinementInput, setRefinementInput] = useState('');

  const resumeRef = useRef<HTMLDivElement>(null);

  // --- Live API State ---
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const nextStartTimeRef = useRef(0);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const transcriptBufferRef = useRef({ user: '', ai: '' });

  const startLiveInterview = async () => {
    setIsLiveActive(true);
    setTranscriptHistory([]);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          const source = audioContextInRef.current!.createMediaStreamSource(stream);
          const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const l = inputData.length;
            const int16 = new Int16Array(l);
            for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
            const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
            sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(audioContextInRef.current!.destination);
        },
        onmessage: async (message) => {
          const parts = message.serverContent?.modelTurn?.parts;
          const base64Audio = parts?.[0]?.inlineData?.data;
          if (base64Audio && audioContextOutRef.current) {
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextOutRef.current.currentTime);
            const buffer = await decodeAudioData(decode(base64Audio), audioContextOutRef.current, 24000, 1);
            const source = audioContextOutRef.current.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContextOutRef.current.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            activeSourcesRef.current.add(source);
            source.onended = () => activeSourcesRef.current.delete(source);
          }
          const interrupted = message.serverContent?.interrupted;
          if (interrupted) {
            for (const s of activeSourcesRef.current) s.stop();
            activeSourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }
          if (message.serverContent?.inputTranscription) transcriptBufferRef.current.user += message.serverContent.inputTranscription.text;
          if (message.serverContent?.outputTranscription) transcriptBufferRef.current.ai += message.serverContent.outputTranscription.text;
          if (message.serverContent?.turnComplete) {
            const u = transcriptBufferRef.current.user;
            const a = transcriptBufferRef.current.ai;
            setTranscriptHistory(prev => [...prev, ...(u ? [{role: 'user' as const, text: u}] : []), ...(a ? [{role: 'ai' as const, text: a}] : [])]);
            setRawExperience(prev => prev + `\nUser: ${u}\nAI: ${a}`);
            transcriptBufferRef.current = { user: '', ai: '' };
          }
        },
        onclose: () => setIsLiveActive(false),
        onerror: () => setIsLiveActive(false),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        systemInstruction: `You are a helpful career assistant. Listen to the user describing their professional experience, achievements, and skills in ${lang === 'zh' ? 'Chinese' : 'English'}. Occasionally acknowledge or ask brief clarifying questions if they pause, but primarily let them speak freely. Your goal is to help them capture their professional DNA for their resume.`
      }
    });
    sessionRef.current = await sessionPromise;
  };

  const stopLiveInterview = () => {
    sessionRef.current?.close();
    setIsLiveActive(false);
    audioContextInRef.current?.close();
    audioContextOutRef.current?.close();
  };

  const handleNext = async () => {
    setLoading(true);
    try {
      if (currentStep === Step.DISCOVERY) {
        if (!structuredExperience) {
          const fileData = uploadedFile ? { data: uploadedFile.data, mimeType: uploadedFile.type } : undefined;
          const result = await aiService.structureExperience(rawExperience, lang, fileData);
          setStructuredExperience(result);
        } else {
          setCurrentStep(Step.FIT_CHECK);
        }
      } else if (currentStep === Step.FIT_CHECK) {
        if (!fitCheck && jd) {
          const result = await aiService.performFitCheck(structuredExperience!, jd, lang);
          setFitCheck(result);
        } else if (fitCheck) {
          const result = await aiService.generateResumeDraft(structuredExperience!, jd, lang, false);
          setResumeDraft(result.resume);
          setDiagnosis(result.diagnosis);
          setCurrentStep(Step.DIAGNOSIS);
        }
      } else if (currentStep === Step.DIAGNOSIS) {
        const currentContent = resumeDraft?.content || '';
        const cleanedContent = currentContent
          .replace(/<span class="match-tag">.*?<\/span>/gi, '') 
          .replace(/(匹配|Match|可迁移能力|Transferable Skills)[:：\s]*.*?(?=\n|$)/gi, '') 
          .replace(/\[\s*(匹配|Match|可迁移能力|Transferable Skills)[:：\s]*.*?\]/gi, '') 
          .replace(/【\s*(匹配|Match|可迁移能力|Transferable Skills)[:：\s]*.*?】/gi, '')
          .replace(/#[^\n]+(匹配|Match|可迁移能力|Transferable Skills)[:：\s].*?(?=\n|$)/gi, '') 
          .replace(/\*\*(匹配|Match|可迁移能力|Transferable Skills)[:：\s]*.*?\*\*/gi, '') 
          .trim();
          
        setResumeDraft(prev => prev ? { ...prev, content: cleanedContent } : null);
        setCurrentStep(Step.POLISH);
      } else if (currentStep === Step.POLISH) {
        if (resumeDraft && jd) {
          const greetings = await aiService.generateGreetingMessage(resumeDraft.content, jd, lang);
          setResumeDraft(prev => prev ? { ...prev, greetings } : null);
          setCurrentStep(Step.GREETING);
        }
      }
    } catch (error) {
      console.error(error);
      alert(t.error);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (currentStep === Step.DISCOVERY && structuredExperience) {
      setStructuredExperience(null);
      setFitCheck(null);
      setResumeDraft(null);
      setDiagnosis(null);
    }
    else if (currentStep === Step.FIT_CHECK && fitCheck) {
      setFitCheck(null);
      setResumeDraft(null);
      setDiagnosis(null);
    }
    else if (currentStep > Step.DISCOVERY) setCurrentStep(currentStep - 1);
  };

  const renderResumeContent = (content: string) => {
    if (!content) return '';
    const highlighted = content.replace(/\[待补充[:：]?.*?\]/g, (match: string) => {
      return `<span class="placeholder-highlight">${match}</span>`;
    });
    return (window as any).marked.parse(highlighted);
  };

  const resetAll = () => {
    setCurrentStep(Step.DISCOVERY);
    setRawExperience('');
    setUploadedFile(null);
    setStructuredExperience(null);
    setJd('');
    setFitCheck(null);
    setResumeDraft(null);
    setDiagnosis(null);
    setRefinementInput('');
    setTranscriptHistory([]);
  };

  const handleExport = async (type: 'pdf' | 'docx' | 'image') => {
    if (!resumeDraft) return;
    const element = resumeRef.current;
    if (!element) return;
 
    if (type === 'pdf') {
      setLoading(true);
      try {
        const originalStyle = element.style.cssText;
        element.style.padding = '20mm'; 
        element.style.boxSizing = 'border-box';
        element.style.width = '210mm';
        element.style.minHeight = '297mm';
        element.style.background = '#ffffff';
        element.style.margin = '0';
        
        const canvas = await (window as any).html2canvas(element, {
          scale: 3, 
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: 210 * 3.78, 
          windowWidth: 210 * 3.78
        });
 
        element.style.cssText = originalStyle;
        const imgData = canvas.toDataURL('image/png');
        const pdf = new (window as any).jspdf.jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`aligned-resume-${lang}.pdf`);
      } catch (err) {
        console.error("PDF Export failed", err);
        alert(t.pdfError);
        window.print();
      } finally {
        setLoading(false);
      }
    } else if (type === 'docx') {
      setLoading(true);
      try {
        const lines = resumeDraft.content.split('\n');
        const docChildren: any[] = [];
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) {
            docChildren.push(new docx.Paragraph({ children: [] }));
            return;
          }
          if (trimmed.startsWith('# ')) {
            docChildren.push(new docx.Paragraph({
              text: trimmed.replace('# ', '').replace(/\*/g, ''),
              heading: docx.HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 120 }
            }));
          } else if (trimmed.startsWith('## ')) {
            docChildren.push(new docx.Paragraph({
              text: trimmed.replace('## ', '').replace(/\*/g, ''),
              heading: docx.HeadingLevel.HEADING_2,
              spacing: { before: 180, after: 90 }
            }));
          } else if (trimmed.startsWith('- ')) {
            const bulletText = trimmed.replace('- ', '');
            const parts = bulletText.split(/(\*\*.*?\*\*)/g);
            const textRuns = parts.map(part => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return new docx.TextRun({ text: part.slice(2, -2), bold: true });
              }
              return new docx.TextRun(part.replace(/\*/g, ''));
            });
            docChildren.push(new docx.Paragraph({ children: textRuns, bullet: { level: 0 }, spacing: { after: 60 } }));
          } else {
            const parts = trimmed.split(/(\*\*.*?\*\*)/g);
            const textRuns = parts.map(part => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return new docx.TextRun({ text: part.slice(2, -2), bold: true });
              }
              return new docx.TextRun(part.replace(/\*/g, ''));
            });
            docChildren.push(new docx.Paragraph({ children: textRuns, spacing: { after: 120 } }));
          }
        });
        const doc = new docx.Document({
          sections: [{
            properties: { page: { margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } } },
            children: docChildren
          }]
        });
        const blob = await docx.Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aligned-resume-${lang}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Docx Export failed", err);
        alert(t.docxError);
      } finally {
        setLoading(false);
      }
    } else if (type === 'image') {
      setLoading(true);
      try {
        const originalStyle = element.style.cssText;
        element.style.padding = '20mm';
        element.style.boxSizing = 'border-box';
        element.style.width = '210mm';
        element.style.minHeight = 'auto'; // Let it grow for long image
        element.style.background = '#ffffff';
        element.style.margin = '0';
        
        const canvas = await (window as any).html2canvas(element, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        });
 
        element.style.cssText = originalStyle;
        const imgData = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imgData;
        a.download = `aligned-resume-${lang}.png`;
        a.click();
      } catch (err) {
        console.error("Image Export failed", err);
        alert(t.error);
      } finally {
        setLoading(false);
      }
    }
  };

  const t = {
    en: {
      discovery: 'Discovery', fitCheck: 'Fit Check', diagnosis: 'Brutal Review', polish: 'Final Polish',
      startInt: 'Start Interview', import: 'Process Experience', runFit: 'Run Fit Check',
      genResume: 'Generate Aligned Resume', apply: 'Apply Feedback & Iterate',
      final: 'Final ATS Polish', download: 'Download', back: 'Back', processing: 'Processing...',
      pdf: 'High-Res PDF', docx: 'Professional DOCX', image: 'Long Image',
      new: 'New Alignment',
      keepDna: 'Keep Resume, Change JD',
      resetDna: 'Change Resume, Re-polish',
      genGreeting: 'Generate Greeting Message',
      greetingTitle: 'HR Greeting Messages',
      greetingDesc: 'Auto-generated openers based on your resume and JD, ready for Boss直聘, LinkedIn, etc.',
      copy: 'Copy',
      copied: 'Copied',
      adviceLabel: 'Selection Advice',
      warningsLabel: 'Important Notes',
      confirmProceed: 'Proceed to Fit Check',
      reviewTitle: 'Professional DNA Review',
      traitsTitle: 'Core Traits',
      pdfHelp: 'Reviewing alignment. Final Polish will strip all internal notes.',
      edit: 'Edit Content',
      save: 'Save & Preview',
      confirmations: 'Needs Confirmation',
      changelog: 'Modification Log',
      protocol: 'Alignment Protocol',
      node: 'Anti-Flattery Node',
      discoveryDesc: 'Provide your professional DNA via voice, resume upload, or both. They will complement each other.',
      recording: 'Recording...',
      stop: 'Stop',
      startVoice: 'Start Voice',
      remove: 'Remove',
      processDna: 'Process Professional DNA',
      locked: 'Dossier Locked',
      pasteJd: 'Paste JD text here...',
      matchIndex: 'Match Index',
      whyMatch: 'Why Match',
      gaps: 'DNA Gaps',
      expectation: 'JD Expectation',
      evidence: 'Your Evidence',
      fit: 'Fit',
      changeJd: 'Change JD',
      skeptical: 'Skeptical Analysis',
      refinement: 'Refinement Loop',
      refinementPlaceholder: 'Address critiques or provide missing evidence...',
      error: 'Process stopped. Data integrity violation or network error.',
      pdfError: 'High-Res PDF export failed. Falling back to browser print.',
      footer: 'Inside-Out DNA Protocol Complete.'
    },
    zh: {
      discovery: '发现 DNA', fitCheck: '匹配检查', diagnosis: '简历诊断', polish: '最终打磨',
      startInt: '开始语音面试', import: '解析简历', runFit: '执行匹配度检查',
      genResume: '生成对齐简历', apply: '应用反馈并迭代',
      final: '最终 ATS 抛光', download: '下载简历', back: '返回', processing: '正在处理...',
      pdf: '高清 PDF', docx: '专业 DOCX', image: '输出长图',
      new: '打磨下一份',
      keepDna: '保留原始简历仅更换JD',
      resetDna: '更换原始简历重新打磨',
      genGreeting: '生成打招呼话术',
      greetingTitle: 'HR 打招呼话术',
      greetingDesc: '基于你的简历和 JD 自动生成的开场白，可直接用于 Boss直聘、LinkedIn 等平台。',
      copy: '复制',
      copied: '已复制',
      adviceLabel: '选择建议',
      warningsLabel: '注意事项',
      confirmProceed: '确认为我的 DNA 并继续',
      reviewTitle: '专业 DNA 文档审阅',
      traitsTitle: '核心特质',
      pdfHelp: '正在审阅匹配度。最终打磨阶段将彻底清除所有匹配标记和提示信息。',
      edit: '手动编辑',
      save: '保存并预览',
      confirmations: '需要你确认/补充',
      changelog: '修改说明',
      protocol: '对齐JD',
      node: '反谄媚式优化',
      discoveryDesc: '通过语音、简历上传或两者结合来提供您的职业 DNA。它们将互为补充。',
      recording: '正在录制...',
      stop: '停止',
      startVoice: '开始语音',
      remove: '移除',
      processDna: '处理职业 DNA',
      locked: '档案已锁定',
      pasteJd: '在此粘贴职位描述 (JD) 文本...',
      matchIndex: '匹配指数',
      whyMatch: '匹配原因',
      gaps: 'DNA 差异',
      expectation: 'JD 期望',
      evidence: '你的证明',
      fit: '匹配度',
      changeJd: '更换 JD',
      skeptical: '怀疑性分析',
      refinement: '迭代循环',
      refinementPlaceholder: '针对诊断建议进行修改或提供缺失的证明...',
      error: '处理停止。数据完整性校验失败或网络错误。',
      pdfError: '高清 PDF 导出失败。正在回退到浏览器打印。',
      docxError: 'DOCX 生成失败。',
      footer: '内而外的 DNA 协议已完成。'
    }
  }[lang];

  const getAvailableSteps = () => {
    const steps = [Step.DISCOVERY];
    if (structuredExperience) steps.push(Step.FIT_CHECK);
    if (structuredExperience && jd && fitCheck) steps.push(Step.DIAGNOSIS);
    if (resumeDraft) steps.push(Step.POLISH);
    return steps;
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-zinc-900 selection:text-white bg-[#fcfcfc] print:bg-white">
      <header className="py-6 px-6 md:px-16 border-b border-zinc-50 flex items-center justify-between sticky top-0 bg-white/70 backdrop-blur-2xl z-50 print:hidden">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-xl transform hover:rotate-6 transition-transform cursor-pointer" onClick={resetAll}>C</div>
          <div className="flex flex-col">
            <span className="font-black text-zinc-900 tracking-tighter text-lg leading-none uppercase">{t.protocol}</span>
            <span className="text-[9px] font-black text-zinc-300 uppercase tracking-[0.4em] mt-1 italic">{t.node}</span>
          </div>
        </div>
        <div className="flex items-center space-x-8">
           <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
              <button onClick={() => setLang('en')} className={`px-4 py-1.5 text-[10px] font-black rounded-md transition-all ${lang === 'en' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-400'}`}>EN</button>
              <button onClick={() => setLang('zh')} className={`px-4 py-1.5 text-[10px] font-black rounded-md transition-all ${lang === 'zh' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-400'}`}>中文</button>
           </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-8 pt-8 print:p-0">
        <div className="print:hidden">
          <StepIndicator 
            currentStep={currentStep} 
            onStepClick={(step) => setCurrentStep(step)}
            availableSteps={getAvailableSteps()}
            lang={lang}
          />
        </div>

        <div className="mt-12">
          {currentStep === Step.DISCOVERY && (
            <div className="animate-fade-in pb-12">
              {!structuredExperience ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="mb-4">
                      <h1 className="text-4xl font-black text-zinc-900 mb-2 tracking-tighter uppercase">{t.discovery}.</h1>
                      <p className="text-zinc-500 text-lg">{t.discoveryDesc}</p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Voice Section */}
                      <div className={`rounded-[40px] border-2 flex flex-col transition-all ${isLiveActive ? 'bg-zinc-900 border-zinc-700 shadow-2xl' : 'bg-white border-zinc-100 shadow-sm'}`}>
                        {!isLiveActive ? (
                          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                            <div className="w-16 h-16 bg-zinc-900 rounded-[22px] flex items-center justify-center mb-6 shadow-xl text-white transform hover:rotate-12 transition-transform cursor-pointer" onClick={startLiveInterview}>
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                            </div>
                            <h3 className="text-lg font-black uppercase tracking-tighter mb-6">{t.startInt}</h3>
                            <button onClick={startLiveInterview} className="px-8 py-3 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-[10px] hover:scale-105 transition-all shadow-lg">{t.startVoice}</button>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col p-6">
                            <div className="flex items-center justify-between mb-6">
                              <span className="text-zinc-500 text-[8px] font-black uppercase tracking-widest">{t.recording}</span>
                              <button onClick={stopLiveInterview} className="px-4 py-1.5 bg-red-500 text-white rounded-full text-[8px] font-black uppercase tracking-widest hover:bg-red-600 transition-all">{t.stop}</button>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-3 max-h-[200px] mb-4 scrollbar-hide px-2">
                              {transcriptHistory.map((item, i) => (
                                <div key={i} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[90%] px-4 py-2 rounded-xl text-xs font-medium leading-relaxed ${item.role === 'user' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-900'}`}>{item.text}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Upload Section */}
                      <div className="rounded-[40px] border-2 border-dashed border-zinc-200 flex flex-col items-center justify-center p-8 glass-card">
                        <input type="file" id="resume-upload" className="hidden" accept="application/pdf,image/*" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => setUploadedFile({ data: reader.result as string, name: file.name, type: file.type });
                            reader.readAsDataURL(file);
                          }
                        }} />
                        <label htmlFor="resume-upload" className="cursor-pointer text-center">
                          <div className="w-14 h-14 bg-zinc-50 rounded-xl flex items-center justify-center mx-auto mb-4 border border-zinc-100"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg></div>
                          <span className="font-black text-zinc-900 uppercase tracking-tighter text-sm block">{uploadedFile ? uploadedFile.name : t.import}</span>
                        </label>
                        {uploadedFile && (
                          <button onClick={() => setUploadedFile(null)} className="mt-4 text-[8px] font-black text-red-500 uppercase tracking-widest">{t.remove}</button>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-center pt-10">
                       <button 
                        onClick={handleNext} 
                        disabled={loading || (!rawExperience.trim() && !uploadedFile)} 
                        className="px-14 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-sm hover:bg-zinc-800 transition-all shadow-2xl flex items-center justify-center gap-3 min-w-[240px] disabled:opacity-30"
                      >
                        {loading ? <><LoadingSpinner /> {t.processing}</> : <span>{t.processDna}</span>}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto animate-fade-in space-y-12">
                   <div className="flex items-center justify-between border-b-2 border-zinc-900 pb-6">
                      <h2 className="text-4xl font-black text-zinc-900 tracking-tighter uppercase italic">{t.reviewTitle}.</h2>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => setIsEditingDna(!isEditingDna)} 
                          className="px-4 py-2 bg-zinc-100 text-zinc-900 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
                        >
                          {isEditingDna ? t.save : t.edit}
                        </button>
                        <span className="px-4 py-2 bg-zinc-100 text-zinc-500 rounded-full text-[10px] font-black uppercase tracking-widest">{t.locked}</span>
                      </div>
                   </div>

                   {isEditingDna ? (
                     <div className="space-y-8">
                        <div className="space-y-4">
                          <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em]">{t.traitsTitle}</h4>
                          <input 
                            className="w-full p-4 rounded-xl border-2 border-zinc-100 focus:border-zinc-900 outline-none font-bold uppercase text-xs"
                            value={structuredExperience.traits.join(', ')}
                            onChange={(e) => setStructuredExperience({
                              ...structuredExperience,
                              traits: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                            })}
                          />
                        </div>
                        <div className="space-y-8">
                          {structuredExperience.sections.map((section, idx) => (
                            <div key={idx} className="space-y-4">
                              <input 
                                className="w-full p-3 text-lg font-black text-zinc-900 uppercase tracking-tight border-l-4 border-zinc-900 pl-4 outline-none bg-zinc-50"
                                value={section.title}
                                onChange={(e) => {
                                  const newSections = [...structuredExperience.sections];
                                  newSections[idx].title = e.target.value;
                                  setStructuredExperience({ ...structuredExperience, sections: newSections });
                                }}
                              />
                              <textarea 
                                className="w-full h-32 p-4 rounded-xl border border-zinc-100 focus:border-zinc-900 outline-none text-zinc-600 font-medium leading-relaxed resize-none"
                                value={section.items.join('\n')}
                                onChange={(e) => {
                                  const newSections = [...structuredExperience.sections];
                                  newSections[idx].items = e.target.value.split('\n').filter(Boolean);
                                  setStructuredExperience({ ...structuredExperience, sections: newSections });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        <div className="lg:col-span-1 space-y-8">
                          <div>
                            <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] mb-4">{t.traitsTitle}</h4>
                            <div className="flex flex-wrap gap-2">
                               {structuredExperience.traits.map((trait, i) => (
                                 <span key={i} className="px-3 py-1.5 bg-zinc-900 text-white rounded-lg text-[10px] font-bold uppercase tracking-tight shadow-md">{trait}</span>
                               ))}
                            </div>
                          </div>
                        </div>
                        <div className="lg:col-span-3 space-y-10">
                          {structuredExperience.sections.map((section, idx) => (
                            <div key={idx} className="space-y-4">
                              <h3 className="text-xl font-black text-zinc-900 uppercase tracking-tight border-l-4 border-zinc-900 pl-4">{section.title}</h3>
                              <ul className="space-y-4">
                                {section.items.map((item, i) => (
                                  <li key={i} className="flex gap-4 items-start">
                                    <div className="w-1.5 h-1.5 bg-zinc-200 rounded-full mt-2 shrink-0" />
                                    <p className="text-zinc-600 font-medium leading-relaxed">{item}</p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                     </div>
                   )}

                   <div className="flex justify-center gap-6 pt-12">
                      <button onClick={handleBack} className="px-10 py-4 border-2 border-zinc-900 text-zinc-900 rounded-full font-black uppercase tracking-widest text-[10px] hover:bg-zinc-50 transition-all">{t.back}</button>
                      <button onClick={handleNext} className="px-16 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-sm hover:scale-105 transition-all shadow-2xl flex items-center justify-center gap-3">
                         {t.confirmProceed}
                      </button>
                   </div>
                </div>
              )}
            </div>
          )}

          {currentStep === Step.FIT_CHECK && (
            <div className="animate-fade-in max-w-6xl mx-auto pb-24 space-y-12">
              {!fitCheck ? (
                <div className="max-w-4xl mx-auto space-y-12 text-center">
                  <h2 className="text-5xl font-black text-zinc-900 tracking-tighter uppercase italic">{t.fitCheck}.</h2>
                  <textarea
                    className="w-full h-[500px] p-10 rounded-[60px] border-2 border-zinc-100 focus:border-zinc-900 outline-none transition-all glass-card shadow-2xl font-medium text-lg placeholder:text-zinc-200"
                    placeholder={t.pasteJd}
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                  />
                  <div className="flex justify-between items-center px-8">
                    <button onClick={handleBack} className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900">{t.back}</button>
                    <button onClick={handleNext} disabled={!jd.trim() || loading} className="px-16 py-6 bg-zinc-900 text-white rounded-full font-black uppercase tracking-[0.2em] text-sm hover:scale-105 shadow-2xl flex items-center gap-3 min-w-[200px] justify-center">
                      {loading ? <LoadingSpinner /> : t.runFit}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-16 animate-fade-in">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-center">
                    <div className="flex flex-col items-center space-y-6">
                      <div className="relative w-48 h-48 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="14" fill="transparent" className="text-zinc-100" />
                          <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="14" fill="transparent" strokeDasharray={552.92} strokeDashoffset={552.92 - (552.92 * fitCheck.score) / 100} className="text-zinc-900 transition-all duration-1000" strokeLinecap="round" />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                          <span className="text-5xl font-black tracking-tighter">{fitCheck.score}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">{t.matchIndex}</span>
                        </div>
                      </div>
                      <div className={`px-10 py-4 rounded-full text-xs font-black uppercase tracking-[0.2em] shadow-xl ${
                        fitCheck.conclusion === 'Go for it' ? 'bg-green-500 text-white' :
                        fitCheck.conclusion === 'Stretch goal' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                      }`}>
                        {fitCheck.conclusion}
                      </div>
                    </div>
                    <div className="lg:col-span-2 grid grid-cols-2 gap-8">
                      <div className="p-10 rounded-[50px] bg-green-50/50 border border-green-100 space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-green-700">{t.whyMatch}</h4>
                        <ul className="space-y-3">
                          {fitCheck.whyMatch.map((p, i) => <li key={i} className="text-sm font-bold text-green-900 leading-tight">✓ {p}</li>)}
                        </ul>
                      </div>
                      <div className="p-10 rounded-[50px] bg-red-50/50 border border-red-100 space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-red-700">{t.gaps}</h4>
                        <ul className="space-y-3">
                          {fitCheck.gaps.map((p, i) => <li key={i} className="text-sm font-bold text-red-900 leading-tight">! {p}</li>)}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-[60px] border border-zinc-100 shadow-2xl overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-50 border-b border-zinc-100">
                        <tr>
                          <th className="px-12 py-8 text-[10px] font-black uppercase tracking-widest text-zinc-400">{t.expectation}</th>
                          <th className="px-12 py-8 text-[10px] font-black uppercase tracking-widest text-zinc-400">{t.evidence}</th>
                          <th className="px-12 py-8 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400">{t.fit}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {fitCheck.comparisonTable.map((row, i) => (
                          <tr key={i} className="hover:bg-zinc-50/30 transition-colors">
                            <td className="px-12 py-8 text-sm font-black text-zinc-900 w-1/3 leading-tight">{row.requirement}</td>
                            <td className="px-12 py-8 text-sm font-medium text-zinc-500 leading-relaxed">{row.evidence}</td>
                            <td className="px-12 py-8 text-center">
                              <span className={`w-3 h-3 rounded-full inline-block ${row.match === 'high' ? 'bg-green-500' : row.match === 'mid' ? 'bg-amber-400' : 'bg-red-400'}`}></span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-center gap-6">
                    <button onClick={() => {
                      setFitCheck(null);
                      setResumeDraft(null);
                      setDiagnosis(null);
                    }} className="px-12 py-5 border-2 border-zinc-900 text-zinc-900 rounded-full font-black uppercase tracking-widest text-[10px] hover:bg-zinc-50 transition-all">{t.changeJd}</button>
                    <button onClick={handleBack} className="px-12 py-5 border-2 border-zinc-200 text-zinc-400 rounded-full font-black uppercase tracking-widest text-[10px] hover:text-zinc-900 transition-all">{t.back}</button>
                    <button onClick={handleNext} disabled={loading} className="px-20 py-6 bg-zinc-900 text-white rounded-full font-black uppercase tracking-[0.3em] text-sm shadow-2xl flex items-center justify-center gap-3 min-w-[240px]">
                      {loading ? <LoadingSpinner /> : t.genResume}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === Step.DIAGNOSIS && (
            <div className="animate-fade-in flex flex-col gap-12 pb-24">
              <div className="flex flex-col items-center">
                <div className="resume-container mx-auto">
                  <div className="bg-white border border-zinc-100 rounded-2xl shadow-2xl min-h-[600px] overflow-hidden p-16">
                      <div 
                        ref={resumeRef}
                        className="resume-content text-zinc-800 leading-[1.6] text-[14px]"
                        dangerouslySetInnerHTML={{ __html: renderResumeContent(resumeDraft?.content || '') }}
                      />
                  </div>
                </div>
              </div>

              {/* Diagnosis and Refinement Loop - Now below the resume */}
              <div className="max-w-4xl mx-auto w-full space-y-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Reasons/Critiques */}
                  <div className="space-y-6">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">{t.diagnosis}</h4>
                    <div className="space-y-4">
                      {diagnosis?.reasons.map((critique, i) => (
                        <div key={i} className="p-6 rounded-[24px] border border-zinc-100 bg-white shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`px-2 py-0.5 rounded-[4px] text-[8px] font-black uppercase tracking-widest text-white ${critique.severity === 'critical' ? 'bg-red-500' : critique.severity === 'major' ? 'bg-amber-500' : 'bg-blue-500'}`}>
                              {critique.severity}
                            </span>
                            <h4 className="font-black text-zinc-900 text-sm uppercase tracking-tight">{critique.title}</h4>
                          </div>
                          <p className="text-xs text-zinc-500 leading-relaxed italic">"{critique.action}"</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* Confirmations */}
                    {diagnosis?.confirmations && diagnosis.confirmations.length > 0 && (
                      <div className="p-6 rounded-[24px] border border-amber-100 bg-amber-50/30 space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          {t.confirmations}
                        </h4>
                        <ul className="space-y-2">
                          {diagnosis.confirmations.map((item, i) => (
                            <li key={i} className="text-xs text-amber-900 font-medium leading-relaxed">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Changelog */}
                    {diagnosis?.changelog && diagnosis.changelog.length > 0 && (
                      <div className="p-6 rounded-[24px] border border-zinc-100 bg-zinc-50/50 space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{t.changelog}</h4>
                        <ul className="space-y-2">
                          {diagnosis.changelog.map((item, i) => (
                            <li key={i} className="text-[11px] text-zinc-600 font-medium leading-relaxed">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-8 bg-zinc-900 rounded-[40px] shadow-2xl space-y-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-white font-black text-[10px] uppercase tracking-[0.2em]">{t.refinement}</h4>
                    <div className="flex gap-4">
                      <button onClick={handleBack} className="text-zinc-500 font-black uppercase tracking-widest text-[9px] hover:text-white transition-all">{t.back}</button>
                    </div>
                  </div>
                  <textarea
                    className="w-full h-32 p-5 rounded-2xl bg-zinc-800 border-none text-white focus:ring-1 focus:ring-white outline-none transition-all text-sm font-medium placeholder:text-zinc-600"
                    placeholder={t.refinementPlaceholder}
                    value={refinementInput}
                    onChange={(e) => setRefinementInput(e.target.value)}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button onClick={async () => {
                      setLoading(true);
                      const res = await aiService.refineResume(resumeDraft!.content, structuredExperience!, jd, refinementInput, lang);
                      setResumeDraft(res.resume);
                      setDiagnosis(res.diagnosis);
                      setRefinementInput('');
                      setLoading(false);
                    }} disabled={loading || !refinementInput.trim()} className="py-5 bg-white text-zinc-900 rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-zinc-100 transition-all">
                      {loading ? <LoadingSpinner color="text-zinc-900" /> : t.apply}
                    </button>
                    <button onClick={handleNext} disabled={loading} className="py-5 bg-zinc-800 border border-zinc-700 text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all">
                      {loading ? <LoadingSpinner /> : t.final}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === Step.POLISH && (
            <div className="animate-fade-in max-w-5xl mx-auto pb-24 space-y-12">
               <div className="flex flex-col md:flex-row md:items-center justify-between print:hidden gap-6">
                  <div className="space-y-1">
                    <h3 className="text-4xl font-black text-zinc-900 tracking-tighter italic uppercase">{t.polish}.</h3>
                    <p className="text-zinc-400 text-xs font-medium">{t.pdfHelp}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setIsEditingResume(!isEditingResume)} className={`px-6 py-2.5 rounded-xl font-black uppercase tracking-widest text-[9px] transition-all flex items-center gap-2 ${isEditingResume ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-900 border border-zinc-200'}`}>
                      {isEditingResume ? t.save : t.edit}
                    </button>
                    <button onClick={() => handleExport('pdf')} disabled={loading} className="px-6 py-2.5 bg-zinc-900 text-white rounded-xl font-black uppercase tracking-widest text-[9px] shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2">
                      {loading ? <LoadingSpinner /> : t.pdf}
                    </button>
                    <button onClick={() => handleExport('docx')} disabled={loading} className="px-6 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl font-black uppercase tracking-widest text-[9px] border border-zinc-200 hover:bg-zinc-200 transition-all flex items-center gap-2">
                      {loading ? <LoadingSpinner color="text-zinc-900" /> : t.docx}
                    </button>
                    <button onClick={() => handleExport('image')} disabled={loading} className="px-6 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl font-black uppercase tracking-widest text-[9px] border border-zinc-200 hover:bg-zinc-200 transition-all flex items-center gap-2">
                      {loading ? <LoadingSpinner color="text-zinc-900" /> : t.image}
                    </button>
                  </div>
               </div>
               <div className="resume-container mx-auto print:shadow-none print:border-none print:p-0 relative group">
                  {isEditingResume ? (
                    <textarea 
                      className="w-full min-h-[1000px] p-16 font-mono text-sm border-2 border-zinc-900 focus:ring-0 outline-none resize-none bg-white shadow-2xl rounded-[40px] leading-relaxed"
                      value={resumeDraft?.content || ''}
                      autoFocus
                      onChange={(e) => setResumeDraft(prev => prev ? { ...prev, content: e.target.value } : null)}
                    />
                  ) : (
                    <div 
                      className="bg-white border border-zinc-100 rounded-2xl shadow-2xl min-h-[1000px] p-16 relative overflow-hidden cursor-text group"
                      onClick={() => setIsEditingResume(true)}
                    >
                       <div className="absolute inset-0 bg-zinc-900/0 group-hover:bg-zinc-900/[0.02] transition-colors flex items-start justify-end p-8 opacity-0 group-hover:opacity-100">
                          <span className="bg-zinc-900 text-white text-[8px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full shadow-xl">{t.edit}</span>
                       </div>
                       <div 
                         ref={resumeRef}
                         className="resume-content text-zinc-800 leading-[1.6] text-[14px]"
                         dangerouslySetInnerHTML={{ __html: renderResumeContent(resumeDraft?.content || '') }}
                       />
                    </div>
                  )}
               </div>
                <div className="flex flex-col md:flex-row items-center justify-center gap-6 print:hidden">
                  <button onClick={handleNext} disabled={loading} className="px-10 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl flex items-center gap-2">
                    {loading ? <LoadingSpinner /> : t.genGreeting}
                  </button>
                  <button onClick={() => {
                    setFitCheck(null);
                    setResumeDraft(null);
                    setDiagnosis(null);
                    setCurrentStep(Step.FIT_CHECK);
                  }} className="px-10 py-5 border-2 border-zinc-900 text-zinc-900 rounded-full font-black uppercase tracking-widest text-xs hover:bg-zinc-50 transition-all shadow-xl">{t.keepDna}</button>
                  <button onClick={resetAll} className="px-10 py-5 bg-zinc-100 text-zinc-400 rounded-full font-black uppercase tracking-widest text-xs hover:text-zinc-900 transition-all shadow-sm">{t.resetDna}</button>
                </div>
            </div>
          )}
          {currentStep === Step.GREETING && resumeDraft?.greetings && (
            <div className="animate-fade-in max-w-4xl mx-auto pb-24 space-y-12">
              <div className="text-center space-y-4">
                <h3 className="text-4xl font-black text-zinc-900 tracking-tighter italic uppercase">{t.greetingTitle}.</h3>
                <p className="text-zinc-500 max-w-2xl mx-auto">{t.greetingDesc}</p>
              </div>

              <div className="grid grid-cols-1 gap-8">
                {[
                  { id: 'concise', title: lang === 'zh' ? '版本A：简洁直接型' : 'Version A: Concise', content: resumeDraft.greetings.concise },
                  { id: 'experience', title: lang === 'zh' ? '版本B：突出经历型' : 'Version B: Experience-focused', content: resumeDraft.greetings.experience },
                  { id: 'casual', title: lang === 'zh' ? '版本C：轻松对话型' : 'Version C: Casual', content: resumeDraft.greetings.casual },
                ].map((version) => (
                  <div key={version.id} className="bg-white border border-zinc-100 rounded-[32px] p-8 shadow-xl space-y-4 relative group">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{version.title}</h4>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(version.content);
                          const btn = document.getElementById(`copy-${version.id}`);
                          if (btn) {
                            const originalText = btn.innerText;
                            btn.innerText = t.copied;
                            setTimeout(() => btn.innerText = originalText, 2000);
                          }
                        }}
                        id={`copy-${version.id}`}
                        className="px-4 py-1.5 bg-zinc-900 text-white rounded-full text-[8px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                      >
                        {t.copy}
                      </button>
                    </div>
                    <p className="text-zinc-800 font-medium leading-relaxed text-lg">{version.content}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="p-8 rounded-[32px] bg-blue-50/50 border border-blue-100 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-700">💡 {t.adviceLabel}</h4>
                  <p className="text-sm font-bold text-blue-900 leading-relaxed">{resumeDraft.greetings.advice}</p>
                </div>
                <div className="p-8 rounded-[32px] bg-amber-50/50 border border-amber-100 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-700">⚠️ {t.warningsLabel}</h4>
                  <ul className="space-y-2">
                    {resumeDraft.greetings.warnings.map((w, i) => (
                      <li key={i} className="text-xs font-bold text-amber-900 leading-tight">• {w}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-center gap-6">
                <button onClick={() => setCurrentStep(Step.POLISH)} className="px-10 py-5 border-2 border-zinc-200 text-zinc-400 rounded-full font-black uppercase tracking-widest text-xs hover:text-zinc-900 transition-all">{t.back}</button>
                <button onClick={resetAll} className="px-10 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl">{t.new}</button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="py-20 text-center border-t border-zinc-50 mt-20 print:hidden">
        <div className="max-w-2xl mx-auto px-6 opacity-30 font-black text-[9px] uppercase tracking-[0.6em]">{t.footer}</div>
      </footer>
    </div>
  );
}

function LoadingSpinner({ color = "text-white" }) {
  return (
    <svg className={`animate-spin h-3 w-3 ${color}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}


import React, { useState, useEffect, useRef } from 'react';
import { Step, StructuredExperience, Diagnosis, ResumeData, FitCheckResult, Language } from './types';
import { StepIndicator } from './components/StepIndicator';
import * as aiService from './services/geminiService';
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
  const [activeTab, setActiveTab] = useState<'speak' | 'upload'>('speak');
  
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
          const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
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
        systemInstruction: `You are a cold career coach. Interview in ${lang === 'zh' ? 'Chinese' : 'English'}. Ask achievements, strengths. No flattery.`
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
        const result = await aiService.generateResumeDraft(structuredExperience!, jd, lang, true);
        
        // Final aggressive cleanup
        const cleanedContent = result.resume.content
          .replace(/<span class="match-tag">.*?<\/span>/gi, '') 
          .replace(/(匹配|Match)[:：\s]*.*?(?=\n|$)/gi, '') 
          .replace(/\[\s*(匹配|Match)[:：\s]*.*?\]/gi, '') 
          .replace(/#[^\n]+(匹配|Match)[:：\s].*?(?=\n|$)/gi, '') 
          .replace(/\*\*(匹配|Match)[:：\s]*.*?\*\*/gi, '') 
          .trim();
          
        setResumeDraft({ ...result.resume, content: cleanedContent });
        setCurrentStep(Step.POLISH);
      }
    } catch (error) {
      console.error(error);
      alert("Process stopped. Data integrity violation or network error.");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (currentStep === Step.DISCOVERY && structuredExperience) setStructuredExperience(null);
    else if (currentStep === Step.FIT_CHECK && fitCheck) setFitCheck(null);
    else if (currentStep > Step.DISCOVERY) setCurrentStep(currentStep - 1);
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

  const handleExport = async (type: 'pdf' | 'docx' | 'txt') => {
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
        alert("High-Res PDF export failed. Falling back to browser print.");
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
        alert("DOCX generation failed.");
      } finally {
        setLoading(false);
      }
    } else {
      const plainText = resumeDraft.content.replace(/[#*]/g, '').trim();
      const blob = new Blob([plainText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aligned-resume-${lang}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const t = {
    en: {
      discovery: 'Discovery', fitCheck: 'Fit Check', diagnosis: 'Brutal Review', polish: 'Final Polish',
      startInt: 'Start Interview', import: 'Process Experience', runFit: 'Run Fit Check',
      genResume: 'Generate Aligned Resume', apply: 'Apply Feedback & Iterate',
      final: 'Final ATS Polish', download: 'Download', back: 'Back', processing: 'Processing...',
      pdf: 'High-Res PDF', docx: 'Professional DOCX', txt: 'TXT',
      new: 'New Alignment',
      confirmProceed: 'Proceed to Fit Check',
      reviewTitle: 'Professional DNA Review',
      traitsTitle: 'Core Traits',
      pdfHelp: 'Reviewing alignment. Final Polish will strip all internal notes.'
    },
    zh: {
      discovery: '发现 DNA', fitCheck: '匹配检查', diagnosis: '简历诊断', polish: '最终打磨',
      startInt: '开始语音面试', import: '解析简历', runFit: '执行匹配度检查',
      genResume: '生成对齐简历', apply: '应用反馈并迭代',
      final: '最终 ATS 抛光', download: '下载简历', back: '返回', processing: '正在处理...',
      pdf: '高清 PDF', docx: '专业 DOCX', txt: 'TXT',
      new: '打磨下一份',
      confirmProceed: '确认为我的 DNA 并继续',
      reviewTitle: '专业 DNA 文档审阅',
      traitsTitle: '核心特质',
      pdfHelp: '正在审阅匹配度。最终打磨阶段将彻底清除所有匹配标记和提示信息。'
    }
  }[lang];

  return (
    <div className="min-h-screen flex flex-col selection:bg-zinc-900 selection:text-white bg-[#fcfcfc] print:bg-white">
      <header className="py-6 px-6 md:px-16 border-b border-zinc-50 flex items-center justify-between sticky top-0 bg-white/70 backdrop-blur-2xl z-50 print:hidden">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-xl transform hover:rotate-6 transition-transform cursor-pointer" onClick={resetAll}>C</div>
          <div className="flex flex-col">
            <span className="font-black text-zinc-900 tracking-tighter text-lg leading-none uppercase">Alignment Protocol</span>
            <span className="text-[9px] font-black text-zinc-300 uppercase tracking-[0.4em] mt-1 italic">Anti-Flattery Node</span>
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
          <StepIndicator currentStep={currentStep} />
        </div>

        <div className="mt-12">
          {currentStep === Step.DISCOVERY && (
            <div className="animate-fade-in pb-12">
              {!structuredExperience ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="mb-4">
                      <h1 className="text-4xl font-black text-zinc-900 mb-2 tracking-tighter uppercase">{t.discovery}.</h1>
                      <p className="text-zinc-500 text-lg">Interview with AI to extract your verifiable professional DNA.</p>
                    </div>
                    <div className="flex space-x-1 p-1 bg-zinc-100 rounded-2xl w-fit mb-6">
                      <button onClick={() => setActiveTab('speak')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'speak' ? 'bg-white shadow-md text-zinc-900' : 'text-zinc-400'}`}>Voice Session</button>
                      <button onClick={() => setActiveTab('upload')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'upload' ? 'bg-white shadow-md text-zinc-900' : 'text-zinc-400'}`}>Import Resume</button>
                    </div>
                    {activeTab === 'speak' ? (
                      <div className={`w-full min-h-[400px] rounded-[40px] border-2 flex flex-col transition-all ${isLiveActive ? 'bg-zinc-900 border-zinc-700 shadow-2xl' : 'bg-white border-zinc-100 shadow-sm'}`}>
                        {!isLiveActive ? (
                          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                            <div className="w-20 h-20 bg-zinc-900 rounded-[28px] flex items-center justify-center mb-8 shadow-2xl text-white transform hover:rotate-12 transition-transform cursor-pointer" onClick={startLiveInterview}>
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                            </div>
                            <h3 className="text-2xl font-black uppercase tracking-tighter mb-10">{t.startInt}</h3>
                            <button onClick={startLiveInterview} className="px-14 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl">Initiate Protocol</button>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col p-8">
                            <div className="flex items-center justify-between mb-8">
                              <span className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Protocol Active</span>
                              <button onClick={stopLiveInterview} className="px-5 py-2 bg-red-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-all">Finish Session</button>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-4 max-h-[300px] mb-8 scrollbar-hide px-4">
                              {transcriptHistory.map((item, i) => (
                                <div key={i} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[85%] px-5 py-3 rounded-2xl text-sm font-medium leading-relaxed ${item.role === 'user' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-900'}`}>{item.text}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full h-96 rounded-[40px] border-2 border-dashed border-zinc-200 flex flex-col items-center justify-center p-10 glass-card">
                        <input type="file" id="resume-upload" className="hidden" accept="application/pdf,image/*" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => setUploadedFile({ data: reader.result as string, name: file.name, type: file.type });
                            reader.readAsDataURL(file);
                          }
                        }} />
                        <label htmlFor="resume-upload" className="cursor-pointer text-center">
                          <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-zinc-100"><svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg></div>
                          <span className="font-black text-zinc-900 uppercase tracking-tighter text-lg">{uploadedFile ? uploadedFile.name : t.import}</span>
                        </label>
                        {uploadedFile && (
                          <button onClick={handleNext} disabled={loading} className="mt-10 px-12 py-4 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 min-w-[160px] shadow-lg hover:scale-105 active:scale-95 transition-all">
                            {loading ? <><LoadingSpinner /> {t.processing}</> : t.import}
                          </button>
                        )}
                      </div>
                    )}
                    {(transcriptHistory.length > 0 && !isLiveActive) && (
                      <div className="flex justify-center pt-8">
                         <button onClick={handleNext} disabled={loading} className="px-14 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-sm hover:bg-zinc-800 transition-all shadow-2xl flex items-center justify-center gap-3 min-w-[200px]">
                          {loading ? <><LoadingSpinner /> {t.processing}</> : <span>Extract Verified DNA</span>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto animate-fade-in space-y-12">
                   <div className="flex items-center justify-between border-b-2 border-zinc-900 pb-6">
                      <h2 className="text-4xl font-black text-zinc-900 tracking-tighter uppercase italic">{t.reviewTitle}.</h2>
                      <span className="px-4 py-2 bg-zinc-100 text-zinc-500 rounded-full text-[10px] font-black uppercase tracking-widest">Dossier Locked</span>
                   </div>

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
                    placeholder="Paste JD text here..."
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
                          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Match Index</span>
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
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-green-700">Why Match</h4>
                        <ul className="space-y-3">
                          {fitCheck.whyMatch.map((p, i) => <li key={i} className="text-sm font-bold text-green-900 leading-tight">✓ {p}</li>)}
                        </ul>
                      </div>
                      <div className="p-10 rounded-[50px] bg-red-50/50 border border-red-100 space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-red-700">DNA Gaps</h4>
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
                          <th className="px-12 py-8 text-[10px] font-black uppercase tracking-widest text-zinc-400">JD Expectation</th>
                          <th className="px-12 py-8 text-[10px] font-black uppercase tracking-widest text-zinc-400">Your Evidence</th>
                          <th className="px-12 py-8 text-center text-[10px] font-black uppercase tracking-widest text-zinc-400">Fit</th>
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
                    <button onClick={handleBack} className="px-12 py-5 border-2 border-zinc-900 text-zinc-900 rounded-full font-black uppercase tracking-widest text-[10px]">{t.back}</button>
                    <button onClick={handleNext} disabled={loading} className="px-20 py-6 bg-zinc-900 text-white rounded-full font-black uppercase tracking-[0.3em] text-sm shadow-2xl flex items-center justify-center gap-3 min-w-[240px]">
                      {loading ? <LoadingSpinner /> : t.genResume}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === Step.DIAGNOSIS && (
            <div className="animate-fade-in flex flex-col lg:flex-row gap-12 pb-24">
              <div className="flex-1 space-y-10">
                <div className="flex items-center justify-between border-b-2 border-zinc-100 pb-6">
                  <h3 className="text-3xl font-black text-zinc-900 tracking-tighter uppercase italic">{t.diagnosis}</h3>
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] px-4 py-2 bg-zinc-900 text-white rounded-full shadow-lg">Skeptical Analysis</span>
                </div>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
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
                <div className="p-8 bg-zinc-900 rounded-[40px] shadow-2xl space-y-4">
                  <h4 className="text-white font-black text-[10px] uppercase tracking-[0.2em]">Refinement Loop</h4>
                  <textarea
                    className="w-full h-32 p-5 rounded-2xl bg-zinc-800 border-none text-white focus:ring-1 focus:ring-white outline-none transition-all text-sm font-medium placeholder:text-zinc-600"
                    placeholder="Address critiques or provide missing evidence..."
                    value={refinementInput}
                    onChange={(e) => setRefinementInput(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={async () => {
                      setLoading(true);
                      const res = await aiService.refineResume(resumeDraft!.content, structuredExperience!, jd, refinementInput, lang);
                      setResumeDraft(res.resume);
                      setDiagnosis(res.diagnosis);
                      setRefinementInput('');
                      setLoading(false);
                    }} disabled={loading || !refinementInput.trim()} className="py-4 bg-white text-zinc-900 rounded-xl font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-2">
                      {loading ? <LoadingSpinner color="text-zinc-900" /> : t.apply}
                    </button>
                    <button onClick={handleNext} disabled={loading} className="py-4 border border-white text-white rounded-xl font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-2">
                      {loading ? <LoadingSpinner /> : t.final}
                    </button>
                  </div>
                </div>
                <div className="flex justify-center">
                  <button onClick={handleBack} className="text-zinc-400 font-black uppercase tracking-widest text-[10px] hover:text-zinc-900 transition-all">{t.back}</button>
                </div>
              </div>
              <div className="flex-1 lg:max-w-xl">
                 <div className="bg-white border border-zinc-100 rounded-[40px] shadow-2xl min-h-[850px] overflow-hidden p-10 prose prose-zinc max-w-none">
                    <div 
                      ref={resumeRef}
                      className="resume-content text-zinc-800 leading-[1.6] text-[14px]"
                      dangerouslySetInnerHTML={{ __html: (window as any).marked.parse(resumeDraft?.content || '') }}
                    />
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
                    <button onClick={() => handleExport('pdf')} disabled={loading} className="px-6 py-2.5 bg-zinc-900 text-white rounded-xl font-black uppercase tracking-widest text-[9px] shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2">
                      {loading ? <LoadingSpinner /> : t.pdf}
                    </button>
                    <button onClick={() => handleExport('docx')} disabled={loading} className="px-6 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl font-black uppercase tracking-widest text-[9px] border border-zinc-200 hover:bg-zinc-200 transition-all flex items-center gap-2">
                      {loading ? <LoadingSpinner color="text-zinc-900" /> : t.docx}
                    </button>
                    <button onClick={() => handleExport('txt')} className="px-6 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl font-black uppercase tracking-widest text-[9px] border border-zinc-200 hover:bg-zinc-200 transition-all">{t.txt}</button>
                  </div>
               </div>
               <div className="resume-container mx-auto print:shadow-none print:border-none print:p-0">
                  <div 
                    ref={resumeRef}
                    className="resume-content text-zinc-800 leading-[1.6] text-[14px]"
                    dangerouslySetInnerHTML={{ __html: (window as any).marked.parse(resumeDraft?.content || '') }}
                  />
               </div>
               <div className="flex flex-col items-center gap-4 print:hidden">
                  <button onClick={resetAll} className="px-12 py-5 bg-zinc-900 text-white rounded-full font-black uppercase tracking-widest text-xs hover:scale-105 transition-all shadow-xl">{t.new}</button>
                  <button onClick={handleBack} className="text-zinc-400 font-black uppercase tracking-widest text-[10px] hover:text-zinc-900 transition-all underline underline-offset-8 decoration-2">{t.back}</button>
               </div>
            </div>
          )}
        </div>
      </main>

      <footer className="py-20 text-center border-t border-zinc-50 mt-20 print:hidden">
        <div className="max-w-2xl mx-auto px-6 opacity-30 font-black text-[9px] uppercase tracking-[0.6em]">Inside-Out DNA Protocol Complete.</div>
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

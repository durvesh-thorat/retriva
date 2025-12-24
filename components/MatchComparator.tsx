
import React, { useEffect, useState } from 'react';
import { ItemReport } from '../types';
import { compareItems, ComparisonResult, getMatchTier } from '../services/geminiService';
import { X, Sparkles, MessageCircle, Check, AlertTriangle, MapPin, Clock, Tag, ScanLine, Loader2, Fingerprint, ShieldCheck, HelpCircle } from 'lucide-react';

interface MatchComparatorProps {
  item1: ItemReport;
  item2: ItemReport;
  onClose: () => void;
  onContact: () => void;
}

const SafeImage = ({ src, alt }: { src?: string, alt?: string }) => {
  const [error, setError] = useState(false);
  if (src && !error) {
    return <img src={src} className="w-full h-full object-contain bg-slate-100 dark:bg-slate-800/50 transition-transform duration-700 hover:scale-110" onError={() => setError(true)} alt={alt} />;
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400">
      <ScanLine className="w-8 h-8 mb-2 opacity-50" />
      <span className="font-bold text-[10px] uppercase tracking-widest">No Visuals</span>
    </div>
  );
};

const ComparisonRow = ({ label, val1, val2, icon: Icon }: { label: string, val1: string, val2: string, icon: any }) => (
  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-4 py-2 sm:py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-0 items-center group hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors px-2 sm:px-4 rounded-xl">
    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 min-w-0">
       <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-slate-800 text-indigo-400 group-hover:text-indigo-600 transition-colors shrink-0">
         <Icon className="w-3 h-3" />
       </div>
       <span className="truncate font-medium text-[11px] sm:text-xs">{val1}</span>
    </div>
    
    <div className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[8px] font-extrabold text-slate-400 uppercase tracking-widest border border-slate-200 dark:border-slate-700 shadow-sm whitespace-nowrap">
      {label}
    </div>

    <div className="flex items-center justify-end gap-2 sm:gap-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 min-w-0 text-right">
       <span className="truncate font-medium text-[11px] sm:text-xs">{val2}</span>
       <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-slate-800 text-indigo-400 group-hover:text-indigo-600 transition-colors shrink-0">
         <Icon className="w-3 h-3" />
       </div>
    </div>
  </div>
);

const MatchComparator: React.FC<MatchComparatorProps> = ({ item1, item2, onClose, onContact }) => {
  const [analysis, setAnalysis] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (loading) {
      const interval = setInterval(() => {
        setLoadingStep(prev => (prev + 1) % 3);
      }, 800);
      return () => clearInterval(interval);
    }
  }, [loading]);

  useEffect(() => {
    const runAnalysis = async () => {
      setLoading(true);
      try {
        const result = await compareItems(item1, item2);
        setAnalysis(result || { 
            confidence: 50, 
            explanation: "Could not retrieve full analysis.", 
            similarities: ["Comparison attempted"], 
            differences: ["Data unavailable"] 
        });
      } catch (e) {
        setAnalysis({ confidence: 0, explanation: "Comparison unavailable.", similarities: [], differences: [] });
      } finally {
        setLoading(false);
      }
    };
    runAnalysis();
  }, [item1, item2]);

  const tier = getMatchTier(analysis?.confidence || 0);
  
  // Icon Mapping
  const IconComponent = tier.iconName === 'ShieldCheck' ? ShieldCheck : 
                       tier.iconName === 'Check' ? Check :
                       tier.iconName === 'HelpCircle' ? HelpCircle : X;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-8 md:p-12 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
       <div className="w-full max-w-4xl h-[100dvh] sm:h-[80vh] md:h-[650px] relative rounded-none sm:rounded-[2rem] p-[1px] bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-2xl flex flex-col overflow-hidden">
          
          <div className="w-full h-full bg-white dark:bg-slate-950 rounded-none sm:rounded-[31px] overflow-hidden flex flex-col relative">
             
             {/* Sticky Header */}
             <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl z-20 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white animate-pulse-slow">
                    <Fingerprint className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 leading-none mb-0.5">
                      Gemini Match
                    </h2>
                    <p className="text-[10px] text-slate-500 font-medium">Deep comparison & verification</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
             </div>

             {/* Content */}
             <div className="flex-1 overflow-y-auto lg:overflow-hidden relative bg-slate-50/50 dark:bg-slate-900/50">
                
                {loading ? (
                   <div className="absolute inset-0 z-30 bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center">
                      <div className="relative w-16 h-16 sm:w-20 sm:h-20 mb-6 sm:mb-8">
                         <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-800"></div>
                         <div className="absolute inset-0 rounded-full border-t-4 border-indigo-500 animate-spin"></div>
                         <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 sm:w-8 h-8 text-indigo-500 animate-pulse" />
                         </div>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-2">Analyzing Match</h3>
                      <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
                         {loadingStep === 0 && "Comparing visual features..."}
                         {loadingStep === 1 && "Verifying timestamps & location..."}
                         {loadingStep === 2 && "Calculating compatibility..."}
                      </p>
                   </div>
                ) : (
                   <div className="flex flex-col lg:flex-row h-auto lg:h-full">
                      
                      {/* Left Panel: Visuals & Data */}
                      <div className="w-full lg:flex-1 lg:overflow-y-auto p-4 sm:p-6">
                         
                         <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-5">
                            {[item1, item2].map((item, idx) => (
                              <div key={idx} className="space-y-2">
                                <div className="relative aspect-[4/3] rounded-xl overflow-hidden shadow-md ring-1 ring-slate-900/5 dark:ring-white/10 bg-slate-900">
                                   <SafeImage src={item.imageUrls[0]} alt={item.title} />
                                   <div className="absolute top-0 left-0 right-0 p-1.5 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
                                      <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-white/20 backdrop-blur-md text-white border border-white/20">
                                        {idx === 0 ? 'Item A' : 'Item B'}
                                      </span>
                                   </div>
                                </div>
                                <h3 className="text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white text-center px-1 line-clamp-1">{item.title}</h3>
                              </div>
                            ))}
                         </div>

                         <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-5">
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                               <ComparisonRow label="CATEGORY" icon={Tag} val1={item1.category} val2={item2.category} />
                               <ComparisonRow label="TIME" icon={Clock} val1={`${item1.date} ${item1.time}`} val2={`${item2.date} ${item2.time}`} />
                               <ComparisonRow label="LOCATION" icon={MapPin} val1={item1.location} val2={item2.location} />
                            </div>
                         </div>
                      </div>

                      {/* Right Panel: Verdict & Analysis */}
                      <div className="w-full lg:w-[320px] bg-white dark:bg-slate-950 border-t lg:border-t-0 lg:border-l border-slate-100 dark:border-slate-800 flex flex-col lg:h-full z-10">
                         
                         <div className="flex-1 lg:overflow-y-auto p-4 sm:p-6">
                            
                            {/* Unified Verdict Card */}
                            <div className={`mb-6 p-6 rounded-2xl border ${tier.bg} ${tier.border} relative overflow-hidden text-center transition-colors duration-500`}>
                               <div className="flex items-center justify-center gap-2 mb-3">
                                   <IconComponent className={`w-5 h-5 ${tier.color}`} />
                                   <span className={`text-lg font-black uppercase tracking-tight ${tier.color}`}>{tier.label}</span>
                               </div>
                               
                               <div className="h-px w-16 bg-current opacity-20 mx-auto mb-3"></div>

                               <p className="text-sm font-medium text-slate-700 dark:text-slate-300 leading-relaxed text-left">
                                   {analysis?.explanation}
                               </p>
                            </div>

                            <div className="space-y-5">
                               <div className="animate-slide-up delay-100">
                                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                     <Check className="w-3 h-3 text-emerald-500" /> Key Matches
                                  </h4>
                                  <div className="space-y-1.5">
                                     {analysis?.similarities && analysis.similarities.length > 0 ? (
                                        analysis.similarities.slice(0, 3).map((sim, i) => (
                                          <div key={i} className="px-2.5 py-1.5 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-lg border border-emerald-100 dark:border-emerald-900/20 text-[10px] sm:text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                                             {sim}
                                          </div>
                                        ))
                                     ) : <p className="text-[10px] text-slate-400 italic">No specific matches.</p>}
                                  </div>
                               </div>

                               <div className="animate-slide-up delay-200">
                                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                     <AlertTriangle className="w-3 h-3 text-red-500" /> Differences
                                  </h4>
                                  <div className="space-y-1.5">
                                     {analysis?.differences && analysis.differences.length > 0 ? (
                                        analysis.differences.slice(0, 3).map((diff, i) => (
                                          <div key={i} className="px-2.5 py-1.5 bg-red-50/50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/20 text-[10px] sm:text-xs font-semibold text-red-800 dark:text-red-200">
                                             {diff}
                                          </div>
                                        ))
                                     ) : <p className="text-[10px] text-slate-400 italic">No significant differences.</p>}
                                  </div>
                               </div>
                            </div>
                         </div>

                         {/* Footer Action */}
                         <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm mt-auto lg:sticky lg:bottom-0">
                            <button onClick={onContact} className="w-full py-3 bg-brand-violet hover:bg-indigo-600 text-white rounded-xl font-bold text-xs sm:text-sm shadow-xl shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 active:scale-95">
                               <MessageCircle className="w-4 h-4" /> Start Conversation
                            </button>
                         </div>

                      </div>
                   </div>
                )}
             </div>
          </div>
       </div>
    </div>
  );
};

export default MatchComparator;

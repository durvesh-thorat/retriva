
import React, { useState, useRef, useEffect } from 'react';
import { ItemReport, ReportType, ItemCategory, User } from '../types';
import { analyzeItemDescription, instantImageCheck } from '../services/geminiService';
import { compressImage } from '../services/imageCompression';
import { Loader2, MapPin, X, Check, Sparkles, Box, SearchX, ShieldBan, UploadCloud, AlertCircle } from 'lucide-react';

interface ReportFormProps {
  type: ReportType;
  user: User;
  initialData?: ItemReport;
  onSubmit: (report: ItemReport) => void;
  onCancel: () => void;
}

type AIFeedback = {
  severity: 'BLOCK' | 'CAUTION' | 'SUCCESS';
  type: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

interface ImageStatus {
  url: string;
  status: 'checking' | 'valid' | 'prank' | 'caution';
  reason?: string;
}

const ReportForm: React.FC<ReportFormProps> = ({ type: initialType, user, initialData, onSubmit, onCancel }) => {
  const [reportType, setReportType] = useState<ReportType>(initialData?.type || initialType);
  const isLost = reportType === ReportType.LOST;
  const isEdit = !!initialData;
  
  // HTML Date Input requires YYYY-MM-DD
  const [date, setDate] = useState(initialData?.date ? convertDDMMtoYYYYMM(initialData.date) : new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(initialData?.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  
  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [location, setLocation] = useState(initialData?.location || '');
  const [category, setCategory] = useState<ItemCategory>(initialData?.category || ItemCategory.OTHER);
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [summary, setSummary] = useState(initialData?.summary || '');
  const [distinguishingFeatures, setDistinguishingFeatures] = useState<string[]>(initialData?.distinguishingFeatures || []);
  
  const [imageStatuses, setImageStatuses] = useState<ImageStatus[]>(
    initialData?.imageUrls.map(url => ({ url, status: 'valid' })) || []
  );
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isVerifyingFinal, setIsVerifyingFinal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<AIFeedback | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const imagesRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null); 

  const isProcessing = isAnalyzing || isVerifyingFinal || isSubmitting;

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Helper to convert DD/MM/YYYY (stored) back to YYYY-MM-DD (input)
  function convertDDMMtoYYYYMM(dateStr: string) {
    if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/');
        return `${y}-${m}-${d}`;
    }
    return dateStr;
  }

  // Helper to convert YYYY-MM-DD (input) to DD/MM/YYYY (storage)
  function formatToDDMMYYYY(dateStr: string) {
    if (dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    }
    return dateStr;
  }

  const performInstantImageCheck = async (index: number, base64: string) => {
    setImageStatuses(prev => prev.map((s, i) => i === index ? { ...s, status: 'checking' } : s));
    const result = await instantImageCheck(base64);
    
    setImageStatuses(prev => prev.map((s, i) => {
      if (i !== index) return s;
      
      if (result.violationType !== 'NONE') {
        setAiFeedback({ 
          severity: 'BLOCK', 
          type: result.violationType, 
          message: `Security Alert: ${result.violationType} detected in image.`,
          actionLabel: 'Remove Image', 
          onAction: () => removeImage(i)
        });
        return { ...s, status: 'prank', reason: result.violationType };
      }
      return { ...s, status: 'valid' };
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && !isProcessing) {
      setFormError(null);
      Array.from(files).forEach((file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const newIndex = imageStatuses.length; // Use current length because setState is async, but roughly correct here
          // We optimistically add it
          setImageStatuses(prev => [...prev, { url: base64, status: 'checking' }]);
          // Then check it (using the calculated index for the new item)
          performInstantImageCheck(newIndex, base64);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    if (!isProcessing) {
      setImageStatuses(prev => prev.filter((_, i) => i !== index));
      setAiFeedback(null);
      setFormError(null);
    }
  };

  const runAnalysis = async () => {
    if (!description && imageStatuses.length === 0) return;
    setIsAnalyzing(true);
    setAiFeedback(null);
    setFormError(null);
    try {
      const result = await analyzeItemDescription(description, imageStatuses.map(s => s.url), title);
      
      if (result.isViolating) {
        setAiFeedback({ 
            severity: 'BLOCK', 
            type: result.violationType || 'IRRELEVANT', 
            message: result.violationReason || "Content violation detected.",
            actionLabel: 'Edit',
            onAction: () => descriptionRef.current?.focus()
        });
      } else {
        setTitle(result.title);
        setCategory(result.category);
        setTags(result.tags || []);
        setDescription(result.description);
        setSummary(result.summary);
        setDistinguishingFeatures(result.distinguishingFeatures || []);
        
        setAiFeedback({ severity: 'SUCCESS', type: 'ENHANCED', message: 'Description optimized by Gemini AI' });
        setTimeout(() => setAiFeedback(prev => prev?.type === 'ENHANCED' ? null : prev), 3000);
      }
    } catch (error) {
      console.error("AI Analysis failed", error);
      setFormError("AI Enhancement failed. Please check your connection.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 1. Mandatory Field Validation
    if (!title.trim() || !description.trim() || !location.trim() || !date || !time) {
      setFormError("All fields (Title, Description, Location, Date, Time) are required.");
      return;
    }

    // 2. Found Item Image Validation
    if (!isLost && imageStatuses.length === 0) {
      setFormError("Found reports MUST include at least one photo.");
      return;
    }

    // 3. Security Block
    if (aiFeedback?.severity === 'BLOCK') return;

    setIsVerifyingFinal(true);
    setAiFeedback(null);

    try {
      const finalCheck = await analyzeItemDescription(description, imageStatuses.map(s => s.url), title);
      if (finalCheck.isViolating || finalCheck.isPrank) {
        setAiFeedback({ 
          severity: 'BLOCK', 
          type: 'VIOLATION', 
          message: finalCheck.violationReason || "Safety check failed. Please remove inappropriate content.",
          actionLabel: 'Review', onAction: () => setAiFeedback(null)
        });
        return;
      }

      setIsSubmitting(true);
      const rawImages = imageStatuses.filter(s => s.status !== 'prank').map(s => s.url);
      const compressedImages = await Promise.all(rawImages.map(url => compressImage(url)));

      const report: ItemReport = {
        id: initialData?.id || crypto.randomUUID(),
        type: reportType,
        title: finalCheck.title || title || 'Untitled Item',
        description: finalCheck.description || description,
        summary: finalCheck.summary || summary || description.slice(0, 100),
        distinguishingFeatures: finalCheck.distinguishingFeatures || distinguishingFeatures,
        category: finalCheck.category || category,
        location,
        date: formatToDDMMYYYY(date), // CONVERT TO DD/MM/YYYY here
        time,
        imageUrls: compressedImages,
        tags: finalCheck.tags || tags,
        status: initialData?.status || 'OPEN',
        reporterId: user.id,
        reporterName: user.name,
        createdAt: initialData?.createdAt || Date.now(),
      };
      onSubmit(report);
    } catch (error) {
      console.error("Submission failed", error);
      setFormError("Failed to submit report. Please try again.");
    } finally {
      setIsVerifyingFinal(false);
      setIsSubmitting(false);
    }
  };

  const isBlocked = aiFeedback?.severity === 'BLOCK';
  const canSubmit = !isSubmitting && !isBlocked && !isAnalyzing;

  const triggerSubmit = () => {
    if (formRef.current) {
      formRef.current.requestSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4 md:p-6 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
      
      {/* Block Overlay */}
      {isBlocked && (
        <div className="absolute inset-0 z-[200] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-white/10 p-6 text-center">
            <ShieldBan className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Content Flagged</h2>
            <p className="text-sm text-slate-500 my-2">{aiFeedback?.message}</p>
            <button onClick={() => { if (aiFeedback?.onAction) aiFeedback.onAction(); setAiFeedback(null); }} className="w-full mt-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm">
               {aiFeedback?.actionLabel || "Dismiss"}
            </button>
            <button onClick={onCancel} className="mt-3 text-sm text-slate-400 font-medium">Discard</button>
          </div>
        </div>
      )}

      {/* Main Form Container */}
      <div className="relative w-full max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-white dark:bg-slate-900 rounded-none sm:rounded-[2rem] shadow-2xl flex flex-col border-0 sm:border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Loading Overlay */}
        {isProcessing && (
           <div className="absolute inset-0 z-[70] bg-white/80 dark:bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center">
             <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
             <p className="font-bold text-slate-900 dark:text-white animate-pulse">
               {isSubmitting ? "Saving..." : isAnalyzing ? "Enhancing..." : "Verifying..."}
             </p>
           </div>
        )}

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              {isEdit ? 'Update Report' : 'Report Item'}
            </h2>
            <p className="text-xs text-slate-400 font-medium mt-0.5">All fields are mandatory</p>
          </div>
          <button onClick={onCancel} disabled={isProcessing} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
          
          {aiFeedback?.severity === 'SUCCESS' && (
             <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{aiFeedback.message}</p>
             </div>
          )}

          {formError && (
             <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 flex items-start gap-3 animate-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm font-bold text-red-800 dark:text-red-300">{formError}</p>
             </div>
          )}

          <form id="report-form" ref={formRef} onSubmit={handleSubmit} className="space-y-8">
            <fieldset disabled={isProcessing} className="space-y-8">
              
              <div className="flex justify-center">
                <div className="bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 inline-flex shadow-sm w-full sm:w-auto">
                  <button type="button" onClick={() => setReportType(ReportType.LOST)} className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${isLost ? 'bg-orange-50 text-orange-700 shadow-sm ring-1 ring-orange-200' : 'text-slate-500'}`}>
                    <SearchX className="w-4 h-4" /> Lost
                  </button>
                  <button type="button" onClick={() => setReportType(ReportType.FOUND)} className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${!isLost ? 'bg-teal-50 text-teal-700 shadow-sm ring-1 ring-teal-200' : 'text-slate-500'}`}>
                    <Box className="w-4 h-4" /> Found
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Left Col */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">1. Details (Required)</h3>
                     <div className="space-y-4">
                        <div className="space-y-1">
                          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Item Name (e.g. MacBook Air)" className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none focus:border-indigo-500" required />
                        </div>
                        <select value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)} className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none focus:border-indigo-500" required>
                           {Object.values(ItemCategory).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <div className="flex gap-2 text-xs flex-wrap">
                          {tags.slice(0,5).map((t,i) => <span key={i} className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-500">#{t}</span>)}
                        </div>
                     </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">2. Time & Place (Required)</h3>
                     <div className="grid grid-cols-2 gap-4 mb-4">
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none" required />
                        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none" required />
                     </div>
                     <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Specific Location (e.g. Library 3rd Floor)" className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none" required />
                  </div>
                </div>

                {/* Right Col */}
                <div className="lg:col-span-5 space-y-6">
                  <div ref={imagesRef} className={`bg-white dark:bg-slate-900 rounded-2xl p-5 border shadow-sm transition-colors ${!isLost && imageStatuses.length === 0 ? 'border-red-300 dark:border-red-900 ring-1 ring-red-200' : 'border-slate-200 dark:border-slate-800'}`}>
                     <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">3. Photos ({imageStatuses.length}/6)</h3>
                        {!isLost && <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Required</span>}
                     </div>
                     
                     <div className="grid grid-cols-3 gap-2 mb-2">
                        {imageStatuses.map((s, idx) => (
                           <div key={idx} className={`aspect-square relative rounded-lg overflow-hidden border ${s.status === 'prank' ? 'border-red-500 ring-2 ring-red-500' : 'border-slate-200 dark:border-slate-700'}`}>
                              <img src={s.url} className={`w-full h-full object-cover ${s.status === 'checking' ? 'opacity-50 grayscale' : ''}`} />
                              {s.status === 'checking' && <div className="absolute inset-0 flex items-center justify-center bg-black/10"><Loader2 className="w-5 h-5 animate-spin text-white drop-shadow-md" /></div>}
                              {s.status === 'prank' && <div className="absolute inset-0 flex items-center justify-center bg-red-500/20"><ShieldBan className="w-6 h-6 text-red-600" /></div>}
                              <button type="button" onClick={() => removeImage(idx)} className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-red-500 transition-colors"><X className="w-3 h-3" /></button>
                           </div>
                        ))}
                        {imageStatuses.length < 6 && (
                           <button type="button" onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                             <UploadCloud className="w-5 h-5 text-slate-400" />
                           </button>
                        )}
                     </div>
                     <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" multiple className="hidden" />
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">4. Description (Required)</h3>
                     <textarea ref={descriptionRef} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the item in detail..." className="w-full flex-1 min-h-[100px] p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-medium resize-none outline-none focus:border-indigo-500" required />
                     <button type="button" onClick={runAnalysis} disabled={!description} className="mt-3 w-full py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50">
                       {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} 
                       {isAnalyzing ? 'Analyzing...' : 'AI Enhance & Verify'}
                     </button>
                  </div>
                </div>

              </div>
            </fieldset>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 flex justify-end gap-3">
          <button onClick={onCancel} disabled={isProcessing} className="px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
          <button
            onClick={triggerSubmit}
            disabled={!canSubmit}
            className={`px-8 py-3 rounded-xl text-white font-bold text-sm shadow-lg transition-all flex items-center gap-2 ${isLost ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-teal-600 hover:bg-teal-700'} disabled:opacity-50 disabled:shadow-none`}
          >
            {isVerifyingFinal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Submit Report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportForm;

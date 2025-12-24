
import React, { useState, useRef, useEffect } from 'react';
import { ItemReport, ReportType, ItemCategory, User } from '../types';
import { analyzeItemDescription, instantImageCheck, extractVisualDetails, mergeDescriptions, detectRedactionRegions, validateReportContext } from '../services/geminiService';
import { uploadImage } from '../services/cloudinary';
import { Loader2, MapPin, X, Check, Sparkles, Box, SearchX, ShieldBan, UploadCloud, AlertCircle, Wand2, Info, LayoutTemplate, Palette, Tag, EyeOff, Edit2, ShieldAlert } from 'lucide-react';

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
  url: string; // Base64 for preview, or Cloudinary URL for existing
  file?: File; // Raw file to upload
  status: 'checking' | 'valid' | 'prank' | 'caution' | 'redacted';
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
  
  // Description State Flow
  const [description, setDescription] = useState(initialData?.description || '');
  const [distinguishingMarks, setDistinguishingMarks] = useState(''); // Previously userContext
  const [isDescriptionGenerated, setIsDescriptionGenerated] = useState(!!initialData?.description);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  
  const [location, setLocation] = useState(initialData?.location || '');
  const [category, setCategory] = useState<ItemCategory>(initialData?.category || ItemCategory.OTHER);
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [summary, setSummary] = useState(initialData?.summary || '');
  const [distinguishingFeatures, setDistinguishingFeatures] = useState<string[]>(initialData?.distinguishingFeatures || []);
  
  const [imageStatuses, setImageStatuses] = useState<ImageStatus[]>(
    initialData?.imageUrls.map(url => ({ url, status: 'valid' })) || []
  );
  
  // AI State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [isRedacting, setIsRedacting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isVerifyingFinal, setIsVerifyingFinal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<AIFeedback | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [visualInsights, setVisualInsights] = useState<any>(null);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null); 

  const isProcessing = isAnalyzing || isVerifyingFinal || isSubmitting || isAutofilling || isMerging || isRedacting;

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

  // Helper to blur regions on canvas
  const blurImageRegions = (base64Str: string, regions: number[][]): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(base64Str); return; }

        // Draw original
        ctx.drawImage(img, 0, 0);

        // Apply blur to regions
        regions.forEach(region => {
          const [ymin, xmin, ymax, xmax] = region;
          const y = (ymin / 1000) * img.height;
          const x = (xmin / 1000) * img.width;
          const h = ((ymax - ymin) / 1000) * img.height;
          const w = ((xmax - xmin) / 1000) * img.width;

          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.filter = 'blur(20px)';
          ctx.drawImage(img, 0, 0);
          ctx.restore();

          // Overlay badge
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(x, y, w, h);
        });

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.src = base64Str;
    });
  };

  // 1. Image Check, Redaction & Autofill Trigger
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && !isProcessing) {
      setFormError(null);
      const file = files[0];
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        let base64 = reader.result as string;
        // Keep original for analysis before we potentially blur it
        const originalBase64 = base64; 
        
        // Optimistic UI update: Store base64 for preview
        setImageStatuses(prev => [...prev, { url: base64, file: file, status: 'checking' }]);
        const newImageIndex = imageStatuses.length; 

        // A. Security & Policy Check (FIRST - on original image)
        try {
            const security = await instantImageCheck(originalBase64);
            if (security.violationType !== 'NONE') {
                setImageStatuses(prev => prev.map((s, i) => i === newImageIndex ? { ...s, status: 'prank' } : s));
                setAiFeedback({ 
                    severity: 'BLOCK', 
                    type: security.violationType, 
                    message: security.reason || "Image rejected by safety policy.", 
                    onAction: () => removeImage(newImageIndex) 
                });
                return; // STOP PROCESS
            }
        } catch (e) {
            console.warn("Security check skipped/failed", e);
        }

        // B. Redaction Check (Documents/Faces/PII)
        setIsRedacting(true);
        let wasRedacted = false;
        try {
          // Detect sensitive regions on the ORIGINAL image
          const regions = await detectRedactionRegions(originalBase64);
          if (regions.length > 0) {
            // Apply Redaction
            const redactedBase64 = await blurImageRegions(originalBase64, regions);
            base64 = redactedBase64; // Update base64 to be the safe version
            
            // Convert back to File for upload
            const res = await fetch(redactedBase64);
            const blob = await res.blob();
            const redactedFile = new File([blob], file.name, { type: 'image/jpeg' });
            
            // Update state with Redacted Image
            setImageStatuses(prev => {
              const newState = [...prev];
              // Replace the item we added
              newState[newImageIndex] = { 
                url: redactedBase64, 
                file: redactedFile, 
                status: 'redacted' 
              };
              return newState;
            });
            wasRedacted = true;
            setAiFeedback({ severity: 'SUCCESS', type: 'REDACTION', message: "Sensitive details auto-blurred for privacy.", actionLabel: 'Ok', onAction: () => setAiFeedback(null) });
          }
        } catch (e) {
          console.error("Redaction error", e);
        } finally {
          setIsRedacting(false);
        }

        if (!wasRedacted) {
           setImageStatuses(prev => prev.map((s, i) => i === newImageIndex ? { ...s, status: 'valid' } : s));
        }

        // C. Autofill (Only if it's the first image)
        if (imageStatuses.length === 0) {
           setIsAutofilling(true);
           try {
             // We can use the redacted base64 for this, usually safe enough for object detection
             const details = await extractVisualDetails(base64);
             // Fill fields if empty
             if (!title) setTitle(details.title);
             if (category === ItemCategory.OTHER) setCategory(details.category);
             if (tags.length === 0) setTags(details.tags || []);
             setDistinguishingFeatures(details.distinguishingFeatures || []);
             
             // CRITICAL FIX: Populate the text input so AI uses these features in description generation
             if (!distinguishingMarks && details.distinguishingFeatures?.length > 0) {
                 setDistinguishingMarks(details.distinguishingFeatures.join(', '));
             }
             
             // Save raw insights for the UI
             setVisualInsights(details);
           } catch (e) {
             console.error("Autofill error", e);
           } finally {
             setIsAutofilling(false);
           }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index: number) => {
    if (!isProcessing) {
      setImageStatuses(prev => prev.filter((_, i) => i !== index));
      if (imageStatuses.length <= 1) setVisualInsights(null);
    }
  };

  // 2. Generate Description (Modified Logic)
  const handleGenerateDescription = async () => {
    setIsMerging(true);
    try {
      // Use distinguishingMarks instead of userContext
      const merged = await mergeDescriptions(distinguishingMarks, visualInsights || { note: "No visual data" });
      setDescription(merged);
      setIsDescriptionGenerated(true);
      setIsEditingDescription(false); // Default to view mode
    } catch (e) {
      console.error(e);
      setFormError("AI generation failed. Please try again.");
    } finally {
      setIsMerging(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 1. Basic Validation
    if (!title.trim() || !description.trim() || !location.trim() || !date || !time) {
      setFormError("Please fill in all required fields.");
      return;
    }

    // STRICT: Found items MUST have an image
    if (!isLost && imageStatuses.length === 0) {
      setFormError("Found reports MUST include a photo.");
      return;
    }

    setIsVerifyingFinal(true);

    try {
      // 2. Cross-Reference Validation Scan (Quick Check)
      // This checks for "Abstract/Invalid Location" or "Inconsistent Title/Category"
      const validationScan = await validateReportContext({
          title, 
          category, 
          location, 
          description
      });

      if (!validationScan.isValid) {
          setAiFeedback({ 
              severity: 'BLOCK', 
              type: 'INCONSISTENCY', 
              message: validationScan.reason || "Report content appears invalid or inconsistent.", 
              actionLabel: 'Edit Report', 
              onAction: () => setAiFeedback(null) 
          });
          setIsVerifyingFinal(false);
          return;
      }

      // 3. Final Content Analysis (Deep Check for Safety)
      const finalCheck = await analyzeItemDescription(description, imageStatuses.map(s => s.url), title);
      
      if (finalCheck.isViolating || finalCheck.isPrank) {
        setAiFeedback({ severity: 'BLOCK', type: 'VIOLATION', message: finalCheck.violationReason || "Safety check failed.", actionLabel: 'Fix', onAction: () => setAiFeedback(null) });
        setIsVerifyingFinal(false);
        return;
      }

      setIsSubmitting(true);
      
      // 4. Upload to Cloudinary
      const validImages = imageStatuses.filter(s => s.status !== 'prank');
      
      const uploadPromises = validImages.map(async (img) => {
        if (img.file) {
          // It's a new (or redacted) image, upload raw file
          return await uploadImage(img.file);
        }
        // It's an existing image (edit mode), keep URL
        return img.url;
      });

      const uploadedUrls = await Promise.all(uploadPromises);

      const report: ItemReport = {
        id: initialData?.id || crypto.randomUUID(),
        type: reportType,
        title: finalCheck.title || title,
        description: finalCheck.description || description,
        summary: finalCheck.summary || description.slice(0, 100),
        distinguishingFeatures: finalCheck.distinguishingFeatures || distinguishingFeatures,
        category: finalCheck.category || category,
        location,
        date: formatToDDMMYYYY(date),
        time,
        imageUrls: uploadedUrls, // Cloudinary URLs
        tags: finalCheck.tags || tags,
        status: initialData?.status || 'OPEN',
        reporterId: user.id,
        reporterName: user.name,
        createdAt: initialData?.createdAt || Date.now(),
      };
      onSubmit(report);
    } catch (error) {
      console.error(error);
      setFormError("Submission failed. Check your connection or try again.");
    } finally {
      setIsVerifyingFinal(false);
      setIsSubmitting(false);
    }
  };

  // Standard input styles for consistency
  const inputClass = "w-full h-12 px-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 transition-all";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4 md:p-6 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
      
      {/* Block Overlay */}
      {aiFeedback?.severity === 'BLOCK' && (
        <div className="absolute inset-0 z-[200] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 text-center border border-white/10">
            <ShieldBan className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Issue Detected</h2>
            <p className="text-sm text-slate-500 mb-6">{aiFeedback?.message}</p>
            <button onClick={() => { if (aiFeedback?.onAction) aiFeedback.onAction(); setAiFeedback(null); }} className="px-6 py-2 bg-slate-200 dark:bg-slate-800 rounded-lg font-bold text-sm">Dismiss</button>
          </div>
        </div>
      )}

      {/* Success/Info Overlay */}
      {aiFeedback?.severity === 'SUCCESS' && (
         <div className="absolute top-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-top-4 fade-in">
            <div className="bg-emerald-500 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
               <EyeOff className="w-5 h-5" />
               <span className="font-bold text-sm">{aiFeedback.message}</span>
               <button onClick={() => setAiFeedback(null)} className="ml-2 bg-white/20 hover:bg-white/30 rounded-full p-1"><X className="w-3 h-3" /></button>
            </div>
         </div>
      )}

      <div className="relative w-full max-w-6xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-white dark:bg-slate-900 rounded-none sm:rounded-[2rem] shadow-2xl flex flex-col border-0 sm:border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Loading Overlay */}
        {isProcessing && (
           <div className="absolute inset-0 z-[70] bg-white/80 dark:bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center">
             <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
             <p className="font-bold text-slate-900 dark:text-white animate-pulse">
               {isSubmitting ? "Validating & Submitting..." : isVerifyingFinal ? "Cross-referencing Data..." : isAutofilling ? "Extracting Details..." : isRedacting ? "Scanning for Sensitive Info..." : isMerging ? "Generating Description..." : "Processing..."}
             </p>
           </div>
        )}

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{isEdit ? 'Edit Report' : 'File Report'}</h2>
            <p className="text-xs text-slate-400">Complete the details below</p>
          </div>
          <button onClick={onCancel} disabled={isProcessing} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><X className="w-6 h-6 text-slate-400" /></button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950/50 p-6 md:p-8">
           
           {formError && (
             <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 flex items-center gap-3 animate-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <p className="text-sm font-bold text-red-800 dark:text-red-300">{formError}</p>
             </div>
           )}

           <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* LEFT COLUMN: Inputs */}
              <div className="space-y-6">
                 
                 {/* 1. Type Selection */}
                 <div className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 inline-flex w-full">
                    <button type="button" onClick={() => setReportType(ReportType.LOST)} className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${isLost ? 'bg-orange-50 text-orange-700 shadow-sm' : 'text-slate-400'}`}>
                       <SearchX className="w-4 h-4" /> Lost Item
                    </button>
                    <button type="button" onClick={() => setReportType(ReportType.FOUND)} className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${!isLost ? 'bg-teal-50 text-teal-700 shadow-sm' : 'text-slate-400'}`}>
                       <Box className="w-4 h-4" /> Found Item
                    </button>
                 </div>

                 {/* 2. Core Details Card */}
                 <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                       <LayoutTemplate className="w-4 h-4 text-indigo-500" />
                       <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Core Details</h3>
                    </div>
                    
                    <div>
                       <label className="text-[11px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Item Title</label>
                       <input 
                         type="text" 
                         value={title} 
                         onChange={e => setTitle(e.target.value)} 
                         placeholder="e.g. Blue Hydroflask" 
                         className={inputClass}
                         required 
                       />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="text-[11px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Category</label>
                          <select value={category} onChange={e => setCategory(e.target.value as ItemCategory)} className={inputClass} required>
                             {Object.values(ItemCategory).map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                       </div>
                       <div>
                          <label className="text-[11px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Date</label>
                          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} required />
                       </div>
                    </div>
                 </div>

                 {/* 3. Location & Time Card */}
                 <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                       <MapPin className="w-4 h-4 text-emerald-500" />
                       <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Where & When</h3>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                       <div className="col-span-2">
                          <label className="text-[11px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Location</label>
                          <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Student Center" className={inputClass} required />
                       </div>
                       <div>
                          <label className="text-[11px] font-bold text-slate-500 uppercase ml-1 mb-1.5 block">Time</label>
                          <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputClass} required />
                       </div>
                    </div>
                 </div>

              </div>

              {/* RIGHT COLUMN: Media & AI */}
              <div className="space-y-6 flex flex-col h-full">
                 
                 {/* 1. Media Upload */}
                 <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative">
                    {/* Mandatory/Optional Badge */}
                    <div className={`absolute top-4 right-4 px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${
                        !isLost 
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900' 
                        : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900'
                    }`}>
                        {!isLost ? '* Required' : 'Optional'}
                    </div>

                    <div className="flex justify-between items-center mb-4">
                       <div className="flex items-center gap-2">
                          <UploadCloud className="w-4 h-4 text-sky-500" />
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Evidence</h3>
                       </div>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                       {imageStatuses.map((s, i) => (
                          <div key={i} className="aspect-square relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group">
                             <img src={s.url} className={`w-full h-full object-cover ${s.status === 'redacted' ? 'blur-[1px]' : ''}`} />
                             
                             {s.status === 'checking' && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-5 h-5 text-white animate-spin" /></div>}
                             {s.status === 'redacted' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                                    <EyeOff className="w-6 h-6 text-white/80" />
                                </div>
                             )}
                             
                             <button type="button" onClick={() => removeImage(i)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
                          </div>
                       ))}
                       {imageStatuses.length < 3 && (
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors gap-1 text-slate-400">
                             <UploadCloud className="w-5 h-5" />
                             <span className="text-[9px] font-bold">Add</span>
                          </button>
                       )}
                    </div>
                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    
                    <p className="mt-3 text-[10px] text-slate-400 flex items-center gap-1.5">
                       <Info className="w-3 h-3" /> 
                       Photos with faces or ID cards will be auto-blurred. Selfies are not allowed.
                    </p>
                 </div>

                 {/* 2. AI & Description Center */}
                 <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex-1 flex flex-col transition-all">
                    <div className="flex items-center gap-2 mb-4">
                       <Wand2 className="w-4 h-4 text-brand-violet" />
                       <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Smart Description</h3>
                    </div>

                    {/* AI Insights Panel */}
                    {visualInsights && (
                       <div className="mb-4 p-4 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-900/30">
                          <div className="flex items-center gap-2 mb-3">
                             <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                             <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">AI Visual Findings</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                             {visualInsights.color && (
                                <span className="px-2 py-1 bg-white dark:bg-slate-800 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
                                  <Palette className="w-3 h-3" /> {visualInsights.color}
                                </span>
                             )}
                             {visualInsights.brand && visualInsights.brand !== "Unknown" && (
                                <span className="px-2 py-1 bg-white dark:bg-slate-800 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
                                  <Tag className="w-3 h-3" /> {visualInsights.brand}
                                </span>
                             )}
                          </div>
                       </div>
                    )}

                    <div className="space-y-4 flex-1 flex flex-col">
                       
                       {/* INPUT MODE: Show when description is NOT generated or user is editing */}
                       {(!isDescriptionGenerated || isEditingDescription) && (
                           <>
                             {/* Distinguishing Features Input */}
                             <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Distinguishing Features or Marks</label>
                                <input 
                                   type="text"
                                   value={distinguishingMarks}
                                   onChange={e => setDistinguishingMarks(e.target.value)}
                                   placeholder="e.g. 'Has a scratch on the back', 'Batman sticker on case'"
                                   className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium outline-none focus:border-indigo-500"
                                />
                             </div>

                             {isEditingDescription ? (
                                <div className="space-y-1 flex-1 flex flex-col animate-in fade-in">
                                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Edit Description</label>
                                  <textarea 
                                     value={description}
                                     onChange={e => setDescription(e.target.value)}
                                     className="w-full flex-1 min-h-[120px] p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium resize-none outline-none focus:border-indigo-500"
                                  />
                                  <button type="button" onClick={() => setIsEditingDescription(false)} className="self-end px-4 py-2 bg-slate-200 dark:bg-slate-800 rounded-lg text-xs font-bold">Done</button>
                                </div>
                             ) : (
                                /* GENERATE BUTTON - Glowing & Pulsing */
                                <button 
                                   type="button" 
                                   onClick={handleGenerateDescription}
                                   className="w-full mt-2 py-3 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 bg-[length:200%_auto] animate-gradient-slow text-white rounded-xl text-sm font-black uppercase tracking-widest shadow-[0_0_20px_rgba(99,102,241,0.5)] hover:shadow-[0_0_30px_rgba(99,102,241,0.7)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                >
                                   {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 animate-pulse" />}
                                   {isMerging ? "Generating..." : "Generate Description"}
                                </button>
                             )}
                           </>
                       )}

                       {/* VIEW MODE: Show only after generation and NOT editing */}
                       {isDescriptionGenerated && !isEditingDescription && (
                          <div className="flex-1 flex flex-col space-y-2 animate-in slide-in-from-bottom-2 fade-in">
                             <div className="flex justify-between items-end">
                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Final Description</label>
                                <button 
                                  type="button" 
                                  onClick={() => setIsEditingDescription(true)}
                                  className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-slate-400 hover:text-indigo-500 rounded-lg transition-colors"
                                  title="Edit Description"
                                >
                                   <Edit2 className="w-3.5 h-3.5" />
                                </button>
                             </div>
                             
                             <div className="p-4 bg-indigo-50/30 dark:bg-slate-950/50 border border-indigo-100/50 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 leading-relaxed min-h-[100px] flex-1">
                                {description}
                             </div>
                          </div>
                       )}

                    </div>
                 </div>

              </div>
           </form>
        </div>

        {/* Footer - Submit Button Only shows if description is generated */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 shrink-0">
           <button onClick={onCancel} className="px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
           
           {isDescriptionGenerated && (
               <button 
                 onClick={() => formRef.current?.requestSubmit()} 
                 disabled={isProcessing} 
                 className="px-8 py-3 bg-brand-violet hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-xl shadow-indigo-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:transform-none flex items-center gap-2 animate-in zoom-in-95"
               >
                  <Check className="w-4 h-4" /> Submit Report
               </button>
           )}
        </div>

      </div>
    </div>
  );
};

export default ReportForm;

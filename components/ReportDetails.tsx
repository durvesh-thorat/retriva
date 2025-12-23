
import React, { useEffect, useState } from 'react';
import { ItemReport, ReportType, User } from '../types';
import { 
  X, MapPin, Calendar, Tag, Check, Sparkles, Loader2, 
  ArrowRight, Clock, Fingerprint, MessageCircle, ChevronLeft, ChevronRight, 
  Box, Maximize2, FileText, ScanSearch, ArrowLeftRight, ExternalLink, AlertCircle
} from 'lucide-react';
import { findSmartMatches } from '../services/geminiService';

interface ReportDetailsProps {
  report: ItemReport;
  allReports: ItemReport[];
  currentUser: User;
  onClose: () => void;
  onResolve: (id: string) => void;
  onEdit: (report: ItemReport) => void;
  onDelete: (id: string) => void;
  onNavigateToChat: (report: ItemReport) => void;
  onViewMatch: (report: ItemReport) => void; // Used for "Switch to Item"
  onCompare?: (item1: ItemReport, item2: ItemReport) => void; // New prop for manual compare
}

const ReportDetails: React.FC<ReportDetailsProps> = ({ report, allReports, currentUser, onClose, onResolve, onEdit, onDelete, onNavigateToChat, onViewMatch, onCompare }) => {
  const isOwner = report.reporterId === currentUser.id;
  const isLost = report.type === ReportType.LOST;
  
  const [activeImg, setActiveImg] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  // Scan State
  const [isScanning, setIsScanning] = useState(false);
  // Store both report and confidence
  const [scanResults, setScanResults] = useState<{ report: ItemReport, confidence: number }[] | null>(null);

  // Fallback Logic for AI Analysis content
  const displayFeatures = (report.distinguishingFeatures && report.distinguishingFeatures.length > 0) 
    ? report.distinguishingFeatures 
    : (report.tags && report.tags.length > 0 ? report.tags : ['Standard Item Details']);

  useEffect(() => {
    // Lock body scroll
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    setImgError(false);
    setActiveImg(0);
    setScanResults(null); // Reset scan when report changes
  }, [report.id]);

  const handleScanNow = async () => {
    setIsScanning(true);
    setScanResults(null);
    try {
        // USE SMART MATCH LOGIC - Returns { report, confidence }[]
        const results = await findSmartMatches(report, allReports);
        setScanResults(results);
    } catch (e) {
        console.error(e);
        setScanResults([]);
    } finally {
        setIsScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4 md:p-6 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
      
      {/* FULLSCREEN LIGHTBOX */}
      {showLightbox && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 animate-in zoom-in-95 duration-200"
          onClick={() => setShowLightbox(false)}
        >
          <button className="absolute top-6 right-6 text-white p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors z-[110]">
            <X className="w-8 h-8" />
          </button>
          
          <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
            <img 
              src={report.imageUrls[activeImg]} 
              className="max-w-full max-h-full object-contain rounded-sm shadow-2xl" 
              alt="Fullscreen item view"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {report.imageUrls.length > 1 && (
            <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-3 px-4 overflow-x-auto pb-2">
              {report.imageUrls.map((url, idx) => (
                 <button 
                  key={idx} 
                  onClick={(e) => { e.stopPropagation(); setActiveImg(idx); }}
                  className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${activeImg === idx ? 'border-brand-violet scale-110' : 'border-white/20 opacity-50'}`}
                 >
                    <img src={url} className="w-full h-full object-cover" />
                 </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Modal Container */}
      <div 
        className="relative w-full max-w-5xl h-[100dvh] sm:h-[85vh] bg-white dark:bg-slate-950 rounded-none sm:rounded-[2rem] shadow-2xl flex flex-col md:flex-row overflow-hidden border-0 sm:border border-slate-200 dark:border-slate-800" 
        onClick={e => e.stopPropagation()}
      >
        
        {/* Close Button - Sticky on Mobile */}
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 z-[60] p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white shadow-lg transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        {/* LEFT PANEL: IMAGES */}
        <div className="w-full md:w-[40%] h-[40dvh] md:h-full bg-slate-100 dark:bg-slate-900 relative shrink-0">
           <div className="w-full h-full relative group bg-slate-200 dark:bg-slate-800">
              {report.imageUrls.length > 0 && !imgError ? (
                <div className="w-full h-full relative cursor-zoom-in" onClick={() => setShowLightbox(true)}>
                  <img 
                    src={report.imageUrls[activeImg]} 
                    className="w-full h-full object-cover" 
                    onError={() => setImgError(true)}
                    alt={report.title}
                  />
                  
                  {/* Subtle Gradient Overlay */}
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent pointer-events-none"></div>

                  <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/40 backdrop-blur-md rounded-lg px-2 py-1 text-white border border-white/10 pointer-events-none">
                      <Maximize2 className="w-3 h-3" />
                      <span className="text-[9px] font-bold uppercase tracking-wider">Expand</span>
                  </div>

                  {/* Navigation Controls */}
                  {report.imageUrls.length > 1 && (
                    <>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setActiveImg(prev => (prev - 1 + report.imageUrls.length) % report.imageUrls.length); }} 
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/30 hover:bg-black/60 backdrop-blur-sm text-white rounded-full transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setActiveImg(prev => (prev + 1) % report.imageUrls.length); }} 
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/30 hover:bg-black/60 backdrop-blur-sm text-white rounded-full transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                    <Box className="w-16 h-16 mb-4 opacity-30" />
                    <p className="font-bold text-sm">No Images</p>
                </div>
              )}

              {/* Type Badge */}
              <div className="absolute top-4 left-4 z-20">
                  <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg backdrop-blur-md border border-white/10 text-white ${isLost ? 'bg-orange-500/90' : 'bg-teal-500/90'}`}>
                    {isLost ? 'Lost' : 'Found'}
                  </span>
              </div>
           </div>
        </div>

        {/* RIGHT PANEL: CONTENT */}
        <div className="flex-1 flex flex-col h-[60dvh] md:h-full bg-white dark:bg-slate-950 min-w-0 relative">
           
           {/* SCROLLABLE CONTENT AREA */}
           <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
              
              {/* Header Info */}
              <div className="space-y-4">
                 <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/30 rounded-md text-[10px] font-bold uppercase tracking-wider text-brand-violet border border-indigo-100 dark:border-indigo-800 flex items-center gap-1">
                      <Tag className="w-3 h-3" /> {report.category}
                    </span>
                    <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {report.date}
                    </span>
                 </div>

                 <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white leading-tight">
                   {report.title}
                 </h1>

                 {/* ACTION: SCAN FOR MATCHES */}
                 {report.status === 'OPEN' && (
                   <div className="space-y-4">
                       {!scanResults ? (
                            <button 
                                onClick={handleScanNow}
                                disabled={isScanning}
                                className="w-full p-4 bg-gradient-to-r from-brand-violet/10 to-purple-600/10 dark:from-brand-violet/20 dark:to-purple-900/20 border border-brand-violet/20 rounded-xl flex items-center justify-between group transition-all hover:bg-brand-violet/15 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-brand-violet rounded-lg shadow-sm group-hover:scale-110 transition-transform">
                                        {isScanning ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <ScanSearch className="w-5 h-5 text-white" />}
                                    </div>
                                    <div className="text-left">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-violet mb-0.5">AI Match Center</p>
                                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            {isScanning ? "Scanning campus database..." : "Scan for similar items"}
                                        </p>
                                    </div>
                                </div>
                                {!isScanning && (
                                    <div className="flex items-center gap-2 text-xs font-bold text-brand-violet">
                                        Scan Now <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                )}
                            </button>
                       ) : (
                           <div className="rounded-xl border border-indigo-100 dark:border-indigo-900 overflow-hidden bg-indigo-50/50 dark:bg-indigo-950/20 animate-in fade-in slide-in-from-top-4">
                               <div className="px-4 py-3 border-b border-indigo-100 dark:border-indigo-900 flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/30">
                                   <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                       <Sparkles className="w-3.5 h-3.5" /> {scanResults.length} Matches Found
                                   </h4>
                                   <button onClick={() => setScanResults(null)} className="text-indigo-400 hover:text-indigo-600"><X className="w-4 h-4" /></button>
                               </div>
                               
                               <div className="p-2 space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                                   {scanResults.length === 0 ? (
                                       <div className="text-center py-6 text-slate-400">
                                           <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-50" />
                                           <p className="text-xs font-bold">No matches found yet.</p>
                                       </div>
                                   ) : (
                                       scanResults.map(({ report: match, confidence }) => (
                                           <div key={match.id} className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 flex items-center gap-3 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors">
                                               <div className="w-12 h-12 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 relative">
                                                   {match.imageUrls[0] ? <img src={match.imageUrls[0]} className="w-full h-full object-cover" /> : <Box className="w-6 h-6 m-auto text-slate-300" />}
                                                   {/* Confidence Badge */}
                                                   <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-bold text-center py-0.5">
                                                      {confidence}%
                                                   </div>
                                               </div>
                                               <div className="flex-1 min-w-0">
                                                   <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{match.title}</p>
                                                   <p className="text-[10px] text-slate-500 truncate flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {match.location}</p>
                                               </div>
                                               <div className="flex gap-2">
                                                   {onCompare && (
                                                       <button 
                                                            onClick={() => onCompare(report, match)}
                                                            className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors"
                                                            title="Compare"
                                                       >
                                                            <ArrowLeftRight className="w-4 h-4" />
                                                       </button>
                                                   )}
                                                   <button 
                                                        onClick={() => onViewMatch(match)}
                                                        className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                                        title="View Item"
                                                   >
                                                        <ExternalLink className="w-4 h-4" />
                                                   </button>
                                               </div>
                                           </div>
                                       ))
                                   )}
                               </div>
                           </div>
                       )}
                   </div>
                 )}
              </div>

              {/* Description */}
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 space-y-2">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <FileText className="w-3 h-3" /> Details
                </h3>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-medium whitespace-pre-wrap">
                   {report.description}
                </p>
              </div>

              {/* Features & Location Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg"><MapPin className="w-4 h-4 text-slate-400" /></div>
                    <div>
                       <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location</h4>
                       <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{report.location}</p>
                    </div>
                 </div>
                 <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
                    <div className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg"><Clock className="w-4 h-4 text-slate-400" /></div>
                    <div>
                       <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time</h4>
                       <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{report.time}</p>
                    </div>
                 </div>
              </div>

              {/* AI Features */}
              {displayFeatures.length > 0 && (
                <div>
                   <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                     <Fingerprint className="w-3 h-3" /> Key Features
                   </h3>
                   <div className="flex flex-wrap gap-2 pb-6">
                      {displayFeatures.map((f, i) => (
                         <span key={i} className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-300">
                           {f}
                         </span>
                      ))}
                   </div>
                </div>
              )}
           </div>

           {/* Sticky Footer */}
           <div className="p-4 md:p-6 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0 z-20">
              {isOwner ? (
                <div className="space-y-3">
                   {report.status === 'OPEN' ? (
                      <button 
                        onClick={() => onResolve(report.id)}
                        className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
                      >
                         <Check className="w-5 h-5" /> Mark Resolved
                      </button>
                   ) : (
                      <div className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-xl font-bold text-center text-xs uppercase tracking-widest">
                         Resolved
                      </div>
                   )}
                   
                   <div className="grid grid-cols-2 gap-3">
                      <button 
                         onClick={() => onEdit(report)}
                         className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-700 hover:bg-slate-100 transition-colors"
                      >
                         Edit
                      </button>
                      <button 
                         onClick={(e) => {
                            e.stopPropagation(); 
                            if (confirmDelete) onDelete(report.id);
                            else {
                               setConfirmDelete(true);
                               setTimeout(() => setConfirmDelete(false), 3000);
                            }
                         }}
                         className={`py-3 rounded-xl font-bold text-xs transition-colors ${
                            confirmDelete ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                         }`}
                      >
                         {confirmDelete ? 'Confirm?' : 'Delete'}
                      </button>
                   </div>
                </div>
              ) : (
                <button 
                  onClick={() => onNavigateToChat(report)} 
                  className="w-full py-4 bg-brand-violet hover:bg-[#4f4dbd] text-white rounded-xl font-bold text-sm shadow-xl shadow-brand-violet/25 transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  <MessageCircle className="w-5 h-5" /> 
                  Contact {isLost ? 'Owner' : 'Finder'}
                </button>
              )}
           </div>

        </div>
      </div>
    </div>
  );
};

export default ReportDetails;

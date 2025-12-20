
import React, { useEffect, useState } from 'react';
import { ItemReport, ReportType, User } from '../types';
import { findPotentialMatches } from '../services/geminiService';
import { 
  X, MapPin, Calendar, Tag, Check, Sparkles, Loader2, 
  ArrowRight, Clock, Fingerprint, MessageCircle, ChevronLeft, ChevronRight, 
  Box, Maximize2, FileText
} from 'lucide-react';

interface ReportDetailsProps {
  report: ItemReport;
  allReports: ItemReport[];
  currentUser: User;
  onClose: () => void;
  onResolve: (id: string) => void;
  onEdit: (report: ItemReport) => void;
  onDelete: (id: string) => void;
  onNavigateToChat: (report: ItemReport) => void;
  onViewMatch: (report: ItemReport, matches?: ItemReport[]) => void;
}

const ReportDetails: React.FC<ReportDetailsProps> = ({ report, allReports, currentUser, onClose, onResolve, onEdit, onDelete, onNavigateToChat, onViewMatch }) => {
  const isOwner = report.reporterId === currentUser.id;
  const isLost = report.type === ReportType.LOST;
  
  const [matchingStatus, setMatchingStatus] = useState<'idle' | 'loading' | 'found' | 'none'>('idle');
  const [potentialMatches, setPotentialMatches] = useState<ItemReport[]>([]);
  const [activeImg, setActiveImg] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  // Fallback Logic for AI Analysis
  const displaySummary = report.summary || (report.description.length > 150 ? report.description.substring(0, 150) + "..." : report.description);
  const displayFeatures = (report.distinguishingFeatures && report.distinguishingFeatures.length > 0) 
    ? report.distinguishingFeatures 
    : (report.tags && report.tags.length > 0 ? report.tags : ['Standard Item Details']);

  useEffect(() => {
    // Lock body scroll
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Trigger matching logic
  useEffect(() => {
    const runMatch = async () => {
      setMatchingStatus('loading');
      const targetType = report.type === ReportType.LOST ? ReportType.FOUND : ReportType.LOST;
      const candidates = allReports.filter(r => r.type === targetType && r.status === 'OPEN');
      
      if (candidates.length === 0) {
        setMatchingStatus('none');
        return;
      }
      try {
        const query = `Title: ${report.title}. Desc: ${report.description}. Loc: ${report.location}`;
        const results = await findPotentialMatches({ description: query, imageUrls: report.imageUrls }, candidates);
        const matchIds = results.map(r => r.id);
        if (matchIds.length > 0) {
          const matches = candidates.filter(c => matchIds.includes(c.id));
          setPotentialMatches(matches);
          setMatchingStatus('found');
        } else {
          setMatchingStatus('none');
        }
      } catch (err) {
        setMatchingStatus('none');
      }
    };
    if (report.status === 'OPEN') runMatch();
  }, [report, allReports]);

  useEffect(() => {
    setImgError(false);
  }, [activeImg, report]);

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

      {/* Main Modal Container - Reduced Size */}
      <div 
        className="relative w-full max-w-4xl h-[100dvh] sm:h-[85vh] md:h-[650px] bg-white dark:bg-slate-950 rounded-none sm:rounded-[2rem] shadow-2xl flex flex-col md:flex-row overflow-hidden border-0 sm:border border-slate-200 dark:border-slate-800" 
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
        {/* Mobile: Top Section (35% height), Desktop: Left Side (45% width) */}
        <div className="w-full md:w-[45%] h-[35dvh] md:h-full bg-slate-100 dark:bg-slate-900 relative shrink-0">
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
        {/* ADDED 'relative' CLASS HERE to fix Footer positioning */}
        <div className="flex-1 flex flex-col h-[65dvh] md:h-full bg-white dark:bg-slate-950 min-w-0 relative">
           
           {/* SCROLLABLE CONTENT AREA */}
           <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 overscroll-contain pb-24">
              
              {/* Header Info */}
              <div className="space-y-3">
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

                 {/* Match Banner */}
                 {report.status === 'OPEN' && matchingStatus === 'found' && (
                   <button 
                       onClick={() => onViewMatch(report, potentialMatches)}
                       className="w-full p-3 bg-gradient-to-r from-brand-violet/5 to-purple-600/5 dark:from-brand-violet/20 dark:to-purple-900/20 border border-brand-violet/20 rounded-xl flex items-center justify-between group transition-all"
                   >
                       <div className="flex items-center gap-3">
                         <div className="p-2 bg-brand-violet rounded-lg shadow-sm">
                             <Sparkles className="w-4 h-4 text-white" />
                         </div>
                         <div className="text-left">
                             <p className="text-[9px] font-bold uppercase tracking-widest text-brand-violet">AI Detection</p>
                             <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Found {potentialMatches.length} Similar Items</p>
                         </div>
                       </div>
                       <ArrowRight className="w-4 h-4 text-brand-violet group-hover:translate-x-1 transition-transform" />
                   </button>
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
                   <div className="flex flex-wrap gap-2">
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
           <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md z-[80]">
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

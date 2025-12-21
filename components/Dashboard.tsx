
import React, { useState, useMemo, useEffect } from 'react';
import { ItemReport, ReportType, ItemCategory, User, ViewState } from '../types';
import { Search, MapPin, SearchX, Box, Sparkles, Clock, Calendar, ArrowRight, Fingerprint, RefreshCw, Loader2, ScanLine, History, CheckCircle2, Zap, Cpu } from 'lucide-react';
import ReportDetails from './ReportDetails';
import { parseSearchQuery, findPotentialMatches } from '../services/geminiService';

interface DashboardProps {
  user: User;
  reports: ItemReport[];
  onNavigate: (view: ViewState) => void;
  onResolve: (id: string) => void;
  onEditReport: (report: ItemReport) => void;
  onDeleteReport: (id: string) => void;
  onCompare: (item1: ItemReport, item2: ItemReport) => void;
  onChatStart: (report: ItemReport) => void;
}

interface ReportCardProps {
  report: ItemReport;
  onClick: () => void;
}

const ReportCard: React.FC<ReportCardProps> = ({ report, onClick }) => {
  const [imgError, setImgError] = useState(false);
  const isLost = report.type === ReportType.LOST;
  const isResolved = report.status === 'RESOLVED';

  return (
    <div 
      onClick={onClick}
      className={`group bg-white dark:bg-slate-900 rounded-[1.5rem] border overflow-hidden hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col h-full relative border-slate-200 dark:border-slate-800
        ${isResolved ? 'opacity-75 grayscale-[0.5] hover:opacity-100 hover:grayscale-0' : 
          (isLost ? 'hover:border-orange-500/50 hover:shadow-2xl hover:shadow-orange-500/20' : 'hover:border-teal-500/50 hover:shadow-2xl hover:shadow-teal-500/20')
        }
      `}
    >
       <div className="absolute top-3 left-3 z-10 flex gap-2">
          <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide shadow-lg text-white backdrop-blur-md ${isLost ? 'bg-orange-500/90' : 'bg-teal-500/90'}`}>
            {isLost ? 'Lost' : 'Found'}
          </span>
          {isResolved && (
            <span className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide shadow-lg text-white backdrop-blur-md bg-emerald-500/90 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Resolved
            </span>
          )}
       </div>

      <div className="h-52 bg-slate-100 dark:bg-slate-800 relative overflow-hidden">
          {!imgError && report.imageUrls[0] ? (
            <img src={report.imageUrls[0]} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" onError={() => setImgError(true)} alt={report.title} loading="lazy" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-800/50">
              <Box className="w-12 h-12 mb-3 opacity-20" />
            </div>
          )}
      </div>

      <div className="p-5 flex-1 flex flex-col gap-4">
          <div>
            <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{report.category}</span>
                <span className="text-[10px] font-medium text-slate-400">{report.date}</span>
            </div>
            <h3 className={`font-bold text-lg text-slate-900 dark:text-white leading-tight line-clamp-2 ${
                isResolved ? 'text-slate-500' : (isLost ? 'group-hover:text-orange-600' : 'group-hover:text-teal-600')
            }`}>
                {report.title}
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mt-auto pt-2">
             <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
             <span className="truncate">{report.location}</span>
          </div>
      </div>

      <div className="px-5 pb-5 pt-0">
         <button className={`w-full py-2.5 rounded-xl bg-off-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs transition-all flex items-center justify-center gap-2
            ${isResolved ? 'hover:bg-slate-200 dark:hover:bg-slate-700' : 
              (isLost ? 'group-hover:bg-orange-600 group-hover:text-white' : 'group-hover:bg-teal-600 group-hover:text-white')
            }
         `}>
            {isResolved ? 'View History' : 'View Details'} <ArrowRight className="w-3.5 h-3.5" />
         </button>
      </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ user, reports, onNavigate, onResolve, onEditReport, onDeleteReport, onCompare, onChatStart }) => {
  const [activeTab, setActiveTab] = useState<ReportType>(ReportType.LOST);
  const [viewStatus, setViewStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessingSearch, setIsProcessingSearch] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ItemReport | null>(null);
  
  // AI Match Center State
  const [activeMatchSource, setActiveMatchSource] = useState<ItemReport | null>(null);
  const [foundMatches, setFoundMatches] = useState<ItemReport[]>([]);
  const [isScanningMatches, setIsScanningMatches] = useState(false);

  const filteredReports = useMemo(() => {
    // Filter by Type AND Status
    let result = reports.filter(r => r.type === activeTab && r.status === viewStatus);
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q) || r.location.toLowerCase().includes(q));
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }, [reports, activeTab, viewStatus, searchQuery]);

  const handleSmartSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsProcessingSearch(true);
    try {
      const { userStatus, refinedQuery } = await parseSearchQuery(searchQuery);
      if (userStatus === 'LOST') setActiveTab(ReportType.FOUND);
      else if (userStatus === 'FOUND') setActiveTab(ReportType.LOST);
      setSearchQuery(refinedQuery);
    } finally {
      setIsProcessingSearch(false);
    }
  };

  const handleManualScan = async (report: ItemReport) => {
    // 1. Close detail view
    setSelectedReport(null);
    // 2. Set Active Source
    setActiveMatchSource(report);
    setFoundMatches([]);
    setIsScanningMatches(true);

    // 3. Scroll to Match Center
    setTimeout(() => {
      document.getElementById('match-center')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    // 4. Perform AI Scan
    try {
      const targetType = report.type === ReportType.LOST ? ReportType.FOUND : ReportType.LOST;
      const candidates = reports.filter(r => r.type === targetType && r.status === 'OPEN');
      
      if (candidates.length > 0) {
        const query = `Title: ${report.title}. Desc: ${report.description}. Loc: ${report.location}`;
        const results = await findPotentialMatches({ description: query, imageUrls: report.imageUrls }, candidates);
        const matchIds = results.map(r => r.id);
        setFoundMatches(candidates.filter(c => matchIds.includes(c.id)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsScanningMatches(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {selectedReport && (
        <ReportDetails 
          report={selectedReport} allReports={reports} currentUser={user} 
          onClose={() => setSelectedReport(null)}
          onResolve={(id) => { onResolve(id); setSelectedReport(null); }}
          onEdit={(r) => { onEditReport(r); setSelectedReport(null); }}
          onDelete={(id) => { onDeleteReport(id); setSelectedReport(null); }}
          onNavigateToChat={(report) => { onChatStart(report); setSelectedReport(null); }}
          onViewMatch={(r) => handleManualScan(r)}
        />
      )}

      {/* Hero Section */}
      <section className="relative mb-12">
          {/* Foundation Layer */}
          <div className="relative rounded-[2rem] bg-slate-950 overflow-hidden shadow-2xl border border-white/10 py-8 px-6 lg:py-16 lg:px-20 min-h-[320px] flex items-center group">
              
              {/* Aurora Orbs - Animated */}
              <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-indigo-600/30 rounded-full blur-[120px] mix-blend-screen pointer-events-none animate-pulse-soft"></div>
              <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] bg-purple-600/30 rounded-full blur-[120px] mix-blend-screen pointer-events-none animate-pulse-soft" style={{ animationDelay: '2s' }}></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-cyan-600/20 rounded-full blur-[100px] mix-blend-screen pointer-events-none animate-pulse-soft" style={{ animationDelay: '4s' }}></div>
              
              {/* Surface Texture */}
              <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none"></div>
              
              <div className="relative z-10 w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                  <div className="space-y-6">
                      {/* Badge */}
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-[10px] font-black backdrop-blur-md text-white shadow-sm tracking-widest uppercase">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                        AI Verified
                      </div>
                      
                      {/* Title */}
                      <h1 className="font-black tracking-tighter leading-[0.9] text-white" style={{ fontSize: 'clamp(2.5rem, 8vw, 4.5rem)' }}>
                        Campus <br/>
                        Lost & Found.
                      </h1>
                      
                      {/* Description */}
                      <p className="text-slate-400 text-base md:text-lg font-medium max-w-md leading-relaxed">
                        Find your items instantly with Retriva's smart matching engine.
                      </p>

                      {/* NEW FEATURES BUTTON: Under the Hood */}
                      <button 
                        onClick={() => onNavigate('FEATURES')}
                        className="relative group inline-flex items-center gap-3 px-6 py-3 bg-slate-950 hover:bg-slate-900 border border-white/10 hover:border-cyan-500/50 transition-all duration-300 rounded-xl overflow-hidden shadow-xl hover:shadow-cyan-500/20 hover:-translate-y-0.5"
                      >
                         {/* Tech Scan Effect */}
                         <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/10 to-transparent -translate-x-full group-hover:animate-shimmer-fast pointer-events-none"></div>
                         
                         <div className="relative flex items-center gap-3">
                             <Cpu className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400 transition-colors" />
                             <span className="text-slate-300 group-hover:text-white font-bold text-sm tracking-wide transition-colors">Under the Hood</span>
                             <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
                         </div>
                      </button>
                  </div>

                  {/* Buttons */}
                  <div className="flex flex-col gap-4 max-w-sm mx-auto w-full lg:ml-auto lg:mr-0">
                     <button 
                       onClick={() => onNavigate('REPORT_LOST')} 
                       className="group relative overflow-hidden p-6 rounded-2xl bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-300 flex items-center gap-5 hover:-translate-y-1 hover:shadow-xl hover:border-white/20"
                     >
                       <div className="absolute inset-0 bg-gradient-to-r from-orange-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                       <div className="relative z-10 w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                          <SearchX className="w-6 h-6" />
                       </div>
                       <div className="relative z-10 text-left">
                          <h3 className="font-bold text-lg text-white leading-tight">I Lost Something</h3>
                          <p className="text-xs text-slate-400 group-hover:text-slate-200 font-medium transition-colors">Create a report for lost items</p>
                       </div>
                       <ArrowRight className="absolute right-6 w-5 h-5 text-white/30 group-hover:text-white group-hover:translate-x-1 transition-all" />
                     </button>

                     <button 
                       onClick={() => onNavigate('REPORT_FOUND')} 
                       className="group relative overflow-hidden p-6 rounded-2xl bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 shadow-lg transition-all duration-300 flex items-center gap-5 hover:-translate-y-1 hover:shadow-xl hover:border-white/20"
                     >
                       <div className="absolute inset-0 bg-gradient-to-r from-teal-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                       <div className="relative z-10 w-12 h-12 bg-teal-500 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                          <Box className="w-6 h-6" />
                       </div>
                       <div className="relative z-10 text-left">
                          <h3 className="font-bold text-lg text-white leading-tight">I Found Something</h3>
                          <p className="text-xs text-slate-400 group-hover:text-slate-200 font-medium transition-colors">Report an item you found</p>
                       </div>
                       <ArrowRight className="absolute right-6 w-5 h-5 text-white/30 group-hover:text-white group-hover:translate-x-1 transition-all" />
                     </button>
                  </div>
              </div>
          </div>
      </section>

      {/* AI Match Center */}
      {(activeMatchSource || isScanningMatches) && (
        <div id="match-center" className="animate-fade-in space-y-5 scroll-mt-24 rounded-[2.5rem] mb-12">
           <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-violet rounded-lg shadow-lg shadow-brand-violet/20 animate-pulse-soft">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">AI Match Center</h2>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">
                    Source: <span className="text-brand-violet">{activeMatchSource?.title}</span>
                  </p>
                </div>
              </div>
              <button onClick={() => setActiveMatchSource(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Close Scanner</button>
           </div>

           <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden p-6 min-h-[300px]">
              {isScanningMatches ? (
                 <div className="flex flex-col items-center justify-center h-64 text-center">
                    <Loader2 className="w-10 h-10 text-brand-violet animate-spin mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Scanning Database</h3>
                    <p className="text-sm text-slate-500">Analyzing visual features and descriptions...</p>
                 </div>
              ) : foundMatches.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                   {foundMatches.map(match => (
                     <div key={match.id} className="group bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-brand-violet/50 hover:shadow-2xl transition-all cursor-pointer overflow-hidden flex flex-col h-48" onClick={() => onCompare(activeMatchSource!, match)}>
                         <div className="h-28 bg-slate-100 dark:bg-slate-900 relative">
                             {match.imageUrls[0] && <img src={match.imageUrls[0]} className="w-full h-full object-cover" />}
                             <div className="absolute inset-0 bg-brand-violet/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <ScanLine className="w-8 h-8 text-white animate-pulse" />
                             </div>
                         </div>
                         <div className="p-3">
                             <h4 className="font-bold text-slate-900 dark:text-white text-xs line-clamp-1 mb-1">{match.title}</h4>
                             <button className="w-full py-1.5 bg-slate-100 dark:bg-slate-700/50 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 rounded-lg group-hover:bg-brand-violet group-hover:text-white transition-colors">Compare Items</button>
                         </div>
                     </div>
                   ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                   <Box className="w-12 h-12 text-slate-300 mb-4" />
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white">No Matches Found</h3>
                   <p className="text-sm text-slate-500 max-w-xs mx-auto mt-2">
                     We couldn't find any items that match yours right now. We'll notify you if something comes up.
                   </p>
                </div>
              )}
           </div>
        </div>
      )}

      {/* Main Content Feed */}
      <section className="space-y-6">
         <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-center gap-4">
            
            {/* Filter Group */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="flex p-1 bg-off-white dark:bg-slate-800 rounded-xl shrink-0">
                   <button onClick={() => setActiveTab(ReportType.LOST)} className={`px-4 sm:px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === ReportType.LOST ? 'bg-white dark:bg-slate-700 text-orange-600 shadow-sm' : 'text-slate-500'}`}>Lost</button>
                   <button onClick={() => setActiveTab(ReportType.FOUND)} className={`px-4 sm:px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === ReportType.FOUND ? 'bg-white dark:bg-slate-700 text-teal-600 shadow-sm' : 'text-slate-500'}`}>Found</button>
                </div>
                
                {/* View History Toggle */}
                <button 
                  onClick={() => setViewStatus(prev => prev === 'OPEN' ? 'RESOLVED' : 'OPEN')}
                  className={`p-2.5 rounded-xl border transition-all ${viewStatus === 'RESOLVED' 
                    ? 'bg-indigo-50 dark:bg-slate-800 border-indigo-200 dark:border-slate-700 text-indigo-600' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600'
                  }`}
                  title={viewStatus === 'OPEN' ? "Show Resolved History" : "Show Active Reports"}
                >
                   <History className="w-5 h-5" />
                </button>
            </div>

            <div className="relative flex-1 w-full">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
               <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSmartSearch()} placeholder="Describe what you are looking for..." className="w-full pl-10 pr-4 py-3 bg-off-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-brand-violet/20 transition-all" />
               {isProcessingSearch && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-brand-violet" />}
            </div>
         </div>

         {/* Section Title for Context */}
         <div className="flex items-center gap-2 px-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {viewStatus === 'RESOLVED' ? 'Resolved Archive' : 'Active Listings'}
            </h3>
            <span className="text-xs text-slate-500">({filteredReports.length} items)</span>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredReports.map(report => <ReportCard key={report.id} report={report} onClick={() => setSelectedReport(report)} />)}
            {filteredReports.length === 0 && (
               <div className="col-span-full py-20 text-center flex flex-col items-center justify-center text-slate-400">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-4">
                     {viewStatus === 'RESOLVED' ? <History className="w-8 h-8 opacity-50" /> : <SearchX className="w-8 h-8 opacity-50" />}
                  </div>
                  <p className="font-bold">No {viewStatus === 'RESOLVED' ? 'resolved' : 'active'} items found.</p>
                  <p className="text-xs mt-1">Try changing the category or search terms.</p>
               </div>
            )}
         </div>
      </section>
    </div>
  );
};

export default Dashboard;

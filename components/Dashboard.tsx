
import React, { useState, useMemo, useEffect } from 'react';
import { ItemReport, ReportType, User, ViewState } from '../types';
import { Search, MapPin, SearchX, Box, Sparkles, ArrowRight, ScanLine, Loader2, RefreshCw, History, CheckCircle2, AlertCircle, Scan, Zap, Layers, Network, Wrench, ShieldCheck, Cpu, ChevronRight, Fingerprint } from 'lucide-react';
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
  
  // AI Match Center State - Manual Control
  const [matches, setMatches] = useState<Record<string, ItemReport[]>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number | null>(null);
  
  const CACHE_DATA_KEY = `retriva_matches_manual_${user.id}`;

  // Load matches from cache on mount (but don't scan)
  useEffect(() => {
    const cached = localStorage.getItem(CACHE_DATA_KEY);
    if (cached) {
      try {
        setMatches(JSON.parse(cached));
      } catch (e) {}
    }
  }, [user.id]);

  const handleManualScan = async () => {
    const myOpenReports = reports.filter(r => r.reporterId === user.id && r.status === 'OPEN');
    
    if (myOpenReports.length === 0) {
      setMatches({});
      localStorage.removeItem(CACHE_DATA_KEY);
      return;
    }

    setIsScanning(true);
    const newMatches: Record<string, ItemReport[]> = {};

    try {
      // Sequential scan to manage API limits
      for (const myItem of myOpenReports) {
        // Look for opposite type (Lost -> Found, Found -> Lost)
        const targetType = myItem.type === ReportType.LOST ? ReportType.FOUND : ReportType.LOST;
        const candidates = reports.filter(r => r.type === targetType && r.status === 'OPEN' && r.reporterId !== user.id);
        
        if (candidates.length > 0) {
           const query = `Title: ${myItem.title}. Desc: ${myItem.description}. Loc: ${myItem.location}`;
           const results = await findPotentialMatches({ description: query, imageUrls: myItem.imageUrls }, candidates);
           
           if (results.length > 0) {
               const matchIds = results.map(r => r.id);
               newMatches[myItem.id] = candidates.filter(c => matchIds.includes(c.id));
           }
        }
      }
      
      setMatches(newMatches);
      localStorage.setItem(CACHE_DATA_KEY, JSON.stringify(newMatches));
      setLastScanTime(Date.now());
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setIsScanning(false);
    }
  };

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

  const hasMatches = Object.keys(matches).length > 0;
  const myItemsCount = reports.filter(r => r.reporterId === user.id && r.status === 'OPEN').length;

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {selectedReport && (
        <ReportDetails 
          report={selectedReport} allReports={reports} currentUser={user} 
          onClose={() => setSelectedReport(null)}
          onResolve={(id) => { onResolve(id); setSelectedReport(null); }}
          onEdit={(r) => { onEditReport(r); setSelectedReport(null); }}
          onDelete={(id) => { onDeleteReport(id); setSelectedReport(null); }}
          onNavigateToChat={(report) => { onChatStart(report); setSelectedReport(null); }}
          onViewMatch={(r) => { 
             document.getElementById('ai-discovery-hub')?.scrollIntoView({ behavior: 'smooth' });
             setSelectedReport(null);
             if (!hasMatches) handleManualScan();
          }}
        />
      )}

      {/* Hero Section */}
      <section className="relative w-full">
          <div className="relative rounded-[2rem] bg-gradient-to-br from-[#1e1b4b] via-[#0f172a] to-[#020617] overflow-hidden p-6 md:p-10 flex flex-col lg:flex-row items-center justify-between gap-8 shadow-2xl border border-white/5">
             
             {/* Background Decor */}
             <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                 <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[100px]"></div>
                 <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]"></div>
             </div>

             {/* Left Side */}
             <div className="relative z-10 w-full max-w-xl space-y-6 text-center lg:text-left">
                 {/* Badge */}
                 <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-indigo-300 backdrop-blur-md mx-auto lg:mx-0">
                     <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                     <span>AI Verified</span>
                 </div>
                 
                 {/* Title */}
                 <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[0.9]">
                    From Lost <br/>
                    to Retrieved
                 </h1>

                 {/* Subtitle */}
                 <p className="text-lg text-slate-400 font-medium leading-relaxed max-w-md mx-auto lg:mx-0">
                     Reconnect with what you’ve lost.
                 </p>

                 {/* Under Hood Button */}
                 <div className="hidden md:flex flex-col items-center lg:items-start gap-2">
                    <button 
                      onClick={() => onNavigate('FEATURES')}
                      className="inline-flex items-center gap-3 px-1 py-1 pr-6 bg-[#1e2030] hover:bg-[#2a2d42] border border-white/5 rounded-full transition-all duration-300 group hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] hover:border-indigo-500/50"
                    >
                        <div className="w-10 h-10 rounded-full bg-[#282a3e] border border-white/5 flex items-center justify-center group-hover:bg-[#363852] transition-colors">
                            <Cpu className="w-5 h-5 text-indigo-400" />
                        </div>
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Under the Hood</span>
                        <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                    </button>
                    <p className="text-[10px] text-slate-500 font-medium pl-2">System design and core ideas</p>
                 </div>
             </div>

             {/* Right Side - Buttons */}
             <div className="relative z-10 w-full max-w-sm flex flex-col gap-4">
                 {/* Lost Button */}
                 <button 
                   onClick={() => onNavigate('REPORT_LOST')}
                   className="w-full flex items-center gap-5 p-5 bg-[#171925] hover:bg-[#1f2233] border border-white/5 rounded-2xl group transition-all duration-300 shadow-lg hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:border-orange-500/50 hover:-translate-y-1"
                 >
                     <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-orange-500/20">
                         <Search className="w-6 h-6 text-white" />
                     </div>
                     <div className="text-left">
                         <h3 className="text-white font-bold text-lg leading-tight">I Lost Something</h3>
                         <p className="text-slate-400 text-xs font-medium mt-0.5">Report a lost item</p>
                     </div>
                     <ArrowRight className="ml-auto w-5 h-5 text-slate-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
                 </button>

                 {/* Found Button */}
                 <button 
                   onClick={() => onNavigate('REPORT_FOUND')}
                   className="w-full flex items-center gap-5 p-5 bg-[#171925] hover:bg-[#1f2233] border border-white/5 rounded-2xl group transition-all duration-300 shadow-lg hover:shadow-[0_0_30px_rgba(20,184,166,0.4)] hover:border-teal-500/50 hover:-translate-y-1"
                 >
                     <div className="w-12 h-12 bg-teal-500 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-teal-500/20">
                         <Box className="w-6 h-6 text-white" />
                     </div>
                     <div className="text-left">
                         <h3 className="text-white font-bold text-lg leading-tight">I Found Something</h3>
                         <p className="text-slate-400 text-xs font-medium mt-0.5">Report a found item</p>
                     </div>
                     <ArrowRight className="ml-auto w-5 h-5 text-slate-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
                 </button>

                  {/* Mobile Only Under Hood Button */}
                  <button 
                   onClick={() => onNavigate('FEATURES')}
                   className="md:hidden w-full flex items-center justify-center gap-3 py-4 mt-2 bg-[#1e2030] hover:bg-[#2a2d42] border border-white/5 rounded-xl transition-all duration-300 group hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] hover:border-indigo-500/50"
                 >
                     <Cpu className="w-4 h-4 text-indigo-400" />
                     <span className="text-xs font-bold text-white uppercase tracking-wider">Under the Hood</span>
                 </button>
             </div>
          </div>
      </section>

      {/* AI DISCOVERY HUB - COMPACT & CLEAN DESIGN */}
      <div id="ai-discovery-hub" className="animate-fade-in space-y-4 scroll-mt-24">
           {/* Compact Header */}
           <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg bg-indigo-50 dark:bg-slate-800 ${hasMatches ? 'text-indigo-600' : 'text-slate-400'}`}>
                   <Network className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">AI Discovery Hub</h2>
                {myItemsCount > 0 && !isScanning && !hasMatches && (
                   <span className="ml-2 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 rounded-md">
                      {myItemsCount} Active Reports
                   </span>
                )}
              </div>
              
              <button 
                onClick={handleManualScan}
                disabled={isScanning || myItemsCount === 0}
                className={`group relative overflow-hidden px-4 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest transition-all flex items-center gap-2
                  ${isScanning 
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed' 
                    : 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-800 hover:border-indigo-500 hover:shadow-sm'
                  }
                `}
              >
                 {isScanning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning...
                    </>
                 ) : (
                    <>
                      <Scan className="w-3.5 h-3.5" /> Scan Network
                    </>
                 )}
              </button>
           </div>

           {/* Main Content Area */}
           <div className="relative">
              
              {/* STATE 1: LOADING */}
              {isScanning && (
                 <div className="h-32 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 flex items-center justify-center backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-2">
                       <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                       <p className="text-xs font-bold text-slate-500">Analyzing vector embeddings...</p>
                    </div>
                 </div>
              )}

              {/* STATE 2: EMPTY / NO MATCHES */}
              {!isScanning && !hasMatches && (
                 <div className="h-24 rounded-2xl bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center px-4">
                     <div className="flex items-center gap-4 text-slate-400">
                        <div className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-sm">
                           <Layers className="w-5 h-5 opacity-50" />
                        </div>
                        <div className="text-left">
                           <p className="text-sm font-bold text-slate-600 dark:text-slate-300">System Standby</p>
                           <p className="text-[11px] font-medium opacity-70">
                              {myItemsCount > 0 ? "Scan to find matches for your active items." : "File a report to start matching."}
                           </p>
                        </div>
                     </div>
                 </div>
              )}

              {/* STATE 3: MATCHES FOUND (Horizontal Scroll) */}
              {!isScanning && hasMatches && (
                 <div className="flex gap-4 overflow-x-auto pb-4 snap-x px-1 scroll-smooth">
                    {Object.entries(matches).map(([sourceId, matchedItems]) => {
                        const sourceItem = reports.find(r => r.id === sourceId);
                        if (!sourceItem) return null;

                        return (
                           <div key={sourceId} className="snap-center shrink-0 w-[420px] h-48 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex overflow-hidden group hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                              
                              {/* Left: Source Item */}
                              <div className="w-36 bg-slate-100 dark:bg-slate-900 relative shrink-0">
                                  {sourceItem.imageUrls[0] ? (
                                    <img src={sourceItem.imageUrls[0]} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                                  ) : <Box className="w-8 h-8 m-auto text-slate-300 absolute inset-0" />}
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                                  <div className="absolute bottom-3 left-3 right-3">
                                     <p className="text-[9px] font-bold text-white/70 uppercase tracking-wider mb-0.5">Your Item</p>
                                     <p className="text-xs font-bold text-white truncate leading-tight">{sourceItem.title}</p>
                                  </div>
                              </div>

                              {/* Right: Matches List */}
                              <div className="flex-1 flex flex-col min-w-0">
                                 <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                                    <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                                       <Sparkles className="w-3 h-3" /> {matchedItems.length} Candidates
                                    </span>
                                 </div>
                                 
                                 <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                                    {(matchedItems as ItemReport[]).map(match => (
                                       <div 
                                         key={match.id}
                                         onClick={() => onCompare(sourceItem, match)}
                                         className="flex items-center gap-3 p-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/10 cursor-pointer transition-colors group/item"
                                       >
                                          <div className="w-8 h-8 rounded-md bg-slate-200 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-300 dark:border-slate-700">
                                             {match.imageUrls[0] && <img src={match.imageUrls[0]} className="w-full h-full object-cover" />}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                             <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">{match.title}</p>
                                             <p className="text-[9px] text-slate-400 truncate">{match.location}</p>
                                          </div>
                                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover/item:text-indigo-500 transition-colors" />
                                       </div>
                                    ))}
                                 </div>
                              </div>

                           </div>
                        );
                    })}
                 </div>
              )}
           </div>
      </div>

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

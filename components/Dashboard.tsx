
import React, { useState, useMemo, useEffect } from 'react';
import { ItemReport, ReportType, User, ViewState } from '../types';
import { Search, MapPin, SearchX, Box, Sparkles, ArrowRight, ScanLine, Loader2, RefreshCw, History, CheckCircle2, AlertCircle, Scan, Zap, Layers, Network, Wrench, ShieldCheck, Cpu } from 'lucide-react';
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
          <div className="relative rounded-[2rem] bg-gradient-to-br from-[#1e1b4b] via-[#0f172a] to-[#020617] overflow-hidden p-8 md:p-12 lg:p-16 flex flex-col lg:flex-row items-center justify-between gap-12 shadow-2xl border border-white/5">
             
             {/* Background Decor */}
             <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                 <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[100px]"></div>
                 <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]"></div>
             </div>

             {/* Left Side */}
             <div className="relative z-10 w-full max-w-xl space-y-8 text-center lg:text-left">
                 {/* Badge */}
                 <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-indigo-300 backdrop-blur-md mx-auto lg:mx-0">
                     <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                     <span>AI Verified</span>
                 </div>
                 
                 {/* Title */}
                 <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[0.9]">
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
                      className="inline-flex items-center gap-3 px-1 py-1 pr-6 bg-[#1e2030] hover:bg-[#2a2d42] border border-white/5 rounded-full transition-all group"
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
                   className="w-full flex items-center gap-5 p-5 bg-[#171925] hover:bg-[#1f2233] border border-white/5 rounded-2xl group transition-all shadow-lg hover:shadow-xl hover:border-white/10"
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
                   className="w-full flex items-center gap-5 p-5 bg-[#171925] hover:bg-[#1f2233] border border-white/5 rounded-2xl group transition-all shadow-lg hover:shadow-xl hover:border-white/10"
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
                   className="md:hidden w-full flex items-center justify-center gap-3 py-4 mt-2 bg-[#1e2030] hover:bg-[#2a2d42] border border-white/5 rounded-xl transition-all group"
                 >
                     <Cpu className="w-4 h-4 text-indigo-400" />
                     <span className="text-xs font-bold text-white uppercase tracking-wider">Under the Hood</span>
                 </button>
             </div>
          </div>
      </section>

      {/* AI DISCOVERY HUB - REDESIGNED */}
      <div id="ai-discovery-hub" className="animate-fade-in space-y-6 scroll-mt-24">
           {/* Header Bar */}
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
              <div className="flex items-center gap-4">
                <div className="relative">
                   <div className="relative p-3 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl shadow-lg shadow-indigo-600/20 border border-white/10">
                      <Network className="w-6 h-6 text-white" />
                   </div>
                   {hasMatches && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse"></span>}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">AI Discovery Hub</h2>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2">
                    Monitoring {myItemsCount} of your active items
                  </p>
                </div>
              </div>
              
              <button 
                onClick={handleManualScan}
                disabled={isScanning || myItemsCount === 0}
                className={`group relative overflow-hidden px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest border transition-all flex items-center gap-2
                  ${isScanning 
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-transparent cursor-not-allowed' 
                    : 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/10'
                  }
                `}
              >
                 {isScanning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Scanning Network...
                    </>
                 ) : (
                    <>
                      <Scan className="w-4 h-4" /> Scan Network
                    </>
                 )}
              </button>
           </div>

           {/* Main Discovery Area */}
           <div className="min-h-[200px] rounded-[2.5rem] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 relative overflow-hidden">
              
              {/* Empty State / Standby */}
              {!isScanning && !hasMatches && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                     <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-sm border border-slate-100 dark:border-slate-700">
                        {myItemsCount > 0 ? <Zap className="w-8 h-8 text-slate-300" /> : <Layers className="w-8 h-8 text-slate-300" />}
                     </div>
                     <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                        {myItemsCount > 0 ? "System Standby" : "No Active Reports"}
                     </h3>
                     <p className="text-sm text-slate-500 max-w-sm leading-relaxed mb-6">
                        {myItemsCount > 0 
                           ? "Click 'Scan Network' to cross-reference your items against the latest database entries using Gemini AI."
                           : "You need to file a report before the AI can start looking for matches."
                        }
                     </p>
                     {myItemsCount > 0 && lastScanTime && (
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                           Last Scan: {new Date(lastScanTime).toLocaleTimeString()}
                        </p>
                     )}
                 </div>
              )}

              {/* Scanning State */}
              {isScanning && (
                 <div className="absolute inset-0 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                    <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 animate-pulse">Analyzing vector embeddings...</p>
                 </div>
              )}

              {/* Results Grid - Improved "Floating Cards" Layout */}
              {hasMatches && (
                 <div className="space-y-8 relative z-10">
                    {Object.entries(matches).map(([sourceId, matchedItems]) => {
                        const sourceItem = reports.find(r => r.id === sourceId);
                        if (!sourceItem) return null;

                        return (
                           <div key={sourceId} className="flex flex-col xl:flex-row gap-6 p-4 rounded-3xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md animate-in slide-in-from-bottom-4">
                              
                              {/* Source Item (Left Anchor) */}
                              <div className="w-full xl:w-72 shrink-0 flex xl:flex-col gap-4 items-center xl:items-start p-2">
                                  <div className="relative w-16 h-16 xl:w-full xl:h-48 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shrink-0">
                                      {sourceItem.imageUrls[0] ? (
                                        <img src={sourceItem.imageUrls[0]} className="w-full h-full object-cover" />
                                      ) : <Box className="w-8 h-8 m-auto text-slate-300 absolute inset-0" />}
                                      <div className="absolute inset-0 bg-indigo-500/10 mix-blend-overlay"></div>
                                      <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded-md text-[9px] font-bold text-white uppercase tracking-wider hidden xl:block">
                                         Your Item
                                      </div>
                                  </div>
                                  <div className="min-w-0">
                                      <h3 className="font-bold text-slate-900 dark:text-white truncate xl:text-lg">{sourceItem.title}</h3>
                                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                                        <MapPin className="w-3 h-3" /> {sourceItem.location}
                                      </p>
                                  </div>
                              </div>

                              {/* Connector Visual (Desktop) */}
                              <div className="hidden xl:flex flex-col justify-center items-center w-12 opacity-30">
                                  <div className="w-full border-t-2 border-dashed border-indigo-400"></div>
                              </div>

                              {/* Matches Stack (Right) */}
                              <div className="flex-1 flex gap-4 overflow-x-auto pb-4 xl:pb-0 items-center pl-2">
                                  {matchedItems.map(match => (
                                     <div 
                                       key={match.id}
                                       onClick={() => onCompare(sourceItem, match)}
                                       className="group relative w-60 shrink-0 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 cursor-pointer hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1 transition-all duration-300"
                                     >
                                         <div className="absolute -top-3 -right-2 z-20">
                                            <span className="px-2 py-1 bg-emerald-500 text-white text-[9px] font-black rounded-lg shadow-sm uppercase tracking-wider">
                                              Match Found
                                            </span>
                                         </div>

                                         <div className="flex gap-3">
                                            <div className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0">
                                                {match.imageUrls[0] ? (
                                                  <img src={match.imageUrls[0]} className="w-full h-full object-cover" />
                                                ) : <Box className="w-6 h-6 m-auto text-slate-300" />}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">{match.title}</h4>
                                                <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
                                                   <ScanLine className="w-3 h-3" /> AI Detected
                                                </div>
                                                <div className="mt-2 text-[10px] font-bold text-indigo-500 group-hover:underline flex items-center gap-1">
                                                   Review Match <ArrowRight className="w-3 h-3" />
                                                </div>
                                            </div>
                                         </div>
                                     </div>
                                  ))}
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

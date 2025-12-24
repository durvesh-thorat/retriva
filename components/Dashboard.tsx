
import React, { useState, useMemo, useEffect } from 'react';
import { ItemReport, ReportType, User, ViewState } from '../types';
import { Search, MapPin, SearchX, Box, Sparkles, ArrowRight, ScanLine, Loader2, RefreshCw, History, CheckCircle2, AlertCircle, Scan, Zap, Layers, Network, Wrench, ShieldCheck, Cpu, ChevronRight, Fingerprint, Radar, ChevronLeft, Target, User as UserIcon, WifiOff, Home, HelpCircle, X, Check } from 'lucide-react';
import ReportDetails from './ReportDetails';
import { parseSearchQuery, findSmartMatches, getMatchTier } from '../services/geminiService';

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

// --- AI DISCOVERY HUB ---
const AIDiscoveryHub = ({ user, reports, onCompare }: { user: User, reports: ItemReport[], onCompare: any }) => {
  const myOpenLostReports = useMemo(() => reports.filter(r => r.reporterId === user.id && r.status === 'OPEN' && r.type === ReportType.LOST), [reports, user.id]);
  const [selectedItem, setSelectedItem] = useState<ItemReport | null>(null);
  
  // States: idle, scanning, results
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'complete'>('idle');
  const [matches, setMatches] = useState<{ report: ItemReport, confidence: number, isOffline: boolean }[]>([]);

  useEffect(() => {
    if (myOpenLostReports.length > 0 && !selectedItem) {
        setSelectedItem(myOpenLostReports[0]);
    }
  }, [myOpenLostReports]);

  // Reset scan state when selection changes
  useEffect(() => {
    setScanState('idle');
    setMatches([]);
  }, [selectedItem?.id]);

  const runScan = async () => {
    if (!selectedItem) return;
    setScanState('scanning');
    try {
        const results = await findSmartMatches(selectedItem, reports);
        setMatches(results);
    } catch (e) {
        console.error("Discovery Scan Error:", e);
    } finally {
        setScanState('complete');
    }
  };

  if (myOpenLostReports.length === 0) return null; 

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[500px] animate-fade-in mb-12">
        
        {/* SIDEBAR: My Active Cases */}
        <div className="w-full lg:w-1/3 flex flex-col gap-4 bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-800 p-6 overflow-hidden">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" /> Active Cases
            </h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {myOpenLostReports.map(item => (
                    <button
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                            selectedItem?.id === item.id 
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 shadow-sm' 
                            : 'bg-slate-50 dark:bg-slate-950/50 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <div className="w-12 h-12 rounded-lg bg-white dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
                            {item.imageUrls[0] ? <img src={item.imageUrls[0]} className="w-full h-full object-cover" /> : <Box className="w-5 h-5 m-auto text-slate-300" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold truncate ${selectedItem?.id === item.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>{item.title}</p>
                            <p className="text-[10px] text-slate-400 truncate">{item.date}</p>
                        </div>
                        {selectedItem?.id === item.id && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>}
                    </button>
                ))}
            </div>
        </div>

        {/* MAIN STAGE: Scanner */}
        <div className="flex-1 bg-slate-900 rounded-[2rem] border border-slate-800 overflow-hidden relative flex flex-col shadow-2xl">
            
            {/* Background Grid */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
            
            {/* Header */}
            <div className="relative z-10 px-6 py-4 border-b border-white/5 flex justify-between items-center bg-slate-900/50 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                        <Radar className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white leading-none">AI Discovery Hub</h3>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">GEMINI 3.0 // ACTIVE</p>
                    </div>
                </div>
                
                {selectedItem && scanState !== 'scanning' && (
                    <button 
                        onClick={runScan}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center gap-2"
                    >
                        {scanState === 'complete' ? <RefreshCw className="w-3.5 h-3.5" /> : <Scan className="w-3.5 h-3.5" />}
                        {scanState === 'complete' ? 'Re-Scan' : 'Start Scan'}
                    </button>
                )}
            </div>

            {/* SCANNING VISUALIZER */}
            <div className="flex-1 relative flex flex-col items-center justify-center p-6">
                
                {/* IDLE STATE */}
                {scanState === 'idle' && selectedItem && (
                    <div className="text-center animate-in fade-in zoom-in-95">
                        <div className="relative w-24 h-24 mx-auto mb-6">
                            <div className="absolute inset-0 bg-indigo-500/20 rounded-full animate-ping"></div>
                            <div className="relative w-full h-full rounded-full bg-slate-800 border-2 border-indigo-500/50 overflow-hidden flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                                {selectedItem.imageUrls[0] ? (
                                    <img src={selectedItem.imageUrls[0]} className="w-full h-full object-cover opacity-80" />
                                ) : <Box className="w-8 h-8 text-indigo-400" />}
                            </div>
                        </div>
                        <h2 className="text-2xl font-black text-white tracking-tight mb-2">Ready to Scan</h2>
                        <p className="text-slate-400 text-sm max-w-xs mx-auto">
                            Initiate AI search to cross-reference "{selectedItem.title}" against visual and semantic database entries.
                        </p>
                    </div>
                )}

                {/* SCANNING STATE */}
                {scanState === 'scanning' && (
                    <div className="flex flex-col items-center justify-center w-full h-full">
                        {/* Radar Animation */}
                        <div className="relative w-64 h-64 flex items-center justify-center">
                            <div className="absolute inset-0 border border-indigo-500/30 rounded-full"></div>
                            <div className="absolute inset-[15%] border border-indigo-500/20 rounded-full"></div>
                            <div className="absolute inset-[30%] border border-indigo-500/10 rounded-full"></div>
                            <div className="absolute w-full h-full bg-gradient-to-r from-transparent via-indigo-500/10 to-transparent animate-spin opacity-50" style={{ clipPath: 'polygon(50% 50%, 100% 0, 100% 50%)' }}></div>
                            
                            {/* Center Item */}
                            <div className="relative z-10 w-20 h-20 rounded-full bg-slate-900 border border-indigo-500 shadow-[0_0_50px_rgba(99,102,241,0.5)] overflow-hidden">
                                {selectedItem?.imageUrls[0] && <img src={selectedItem.imageUrls[0]} className="w-full h-full object-cover opacity-80" />}
                            </div>
                        </div>
                        <div className="mt-8 space-y-2 text-center">
                            <div className="text-indigo-400 font-mono text-xs animate-pulse">ANALYZING VECTORS...</div>
                            <div className="text-slate-500 font-mono text-[10px]">Processing visual & semantic data</div>
                        </div>
                    </div>
                )}

                {/* RESULTS STATE */}
                {scanState === 'complete' && (
                    <div className="w-full h-full flex flex-col animate-in fade-in slide-in-from-bottom-4">
                        {matches.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center">
                                <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mb-4 border border-slate-700">
                                    <ShieldCheck className="w-8 h-8 text-emerald-500" />
                                </div>
                                <h3 className="text-lg font-bold text-white">Monitoring Active</h3>
                                <p className="text-slate-400 text-sm max-w-sm mt-2 leading-relaxed">
                                    No direct matches found right now. Our AI agent has indexed this item and will alert you if a matching item is reported.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full overflow-y-auto pr-2 custom-scrollbar max-h-full content-start">
                                {matches.map(({ report, confidence, isOffline }) => {
                                    const tier = getMatchTier(confidence);
                                    return (
                                        <div key={report.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-3 flex gap-3 hover:bg-slate-800 transition-colors group">
                                            <div className="w-20 h-20 bg-slate-900 rounded-lg overflow-hidden shrink-0 relative border border-white/5">
                                                {report.imageUrls[0] && <img src={report.imageUrls[0]} className="w-full h-full object-cover" />}
                                                <div className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase backdrop-blur-md text-slate-900 ${
                                                    tier.label === 'Definitive Match' ? 'bg-emerald-400' :
                                                    tier.label === 'Strong Candidate' ? 'bg-blue-400' : 'bg-amber-400'
                                                }`}>
                                                    {tier.label === 'Definitive Match' ? 'Exact' : tier.label === 'Strong Candidate' ? 'Strong' : 'Potential'}
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col">
                                                <div className="flex justify-between items-start">
                                                    <h4 className="text-sm font-bold text-white truncate pr-2">{report.title}</h4>
                                                    {isOffline && (
                                                      <span title="Offline Match">
                                                        <WifiOff className="w-3 h-3 text-slate-500" />
                                                      </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-400 truncate mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> {report.location}</p>
                                                <div className="mt-auto pt-2">
                                                    <button 
                                                        onClick={() => onCompare(selectedItem!, report)}
                                                        className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors"
                                                    >
                                                        Verify Match
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ user, reports, onNavigate, onResolve, onEditReport, onDeleteReport, onCompare, onChatStart }) => {
  const [activeTab, setActiveTab] = useState<ReportType>(ReportType.LOST);
  const [viewStatus, setViewStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [showMyReports, setShowMyReports] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessingSearch, setIsProcessingSearch] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ItemReport | null>(null);

  const filteredReports = useMemo(() => {
    let result = reports.filter(r => r.type === activeTab && r.status === viewStatus);
    
    if (showMyReports) {
        result = result.filter(r => r.reporterId === user.id);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q) || r.location.toLowerCase().includes(q));
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }, [reports, activeTab, viewStatus, searchQuery, showMyReports, user.id]);

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

  const handleHomeReset = () => {
    setActiveTab(ReportType.LOST);
    setViewStatus('OPEN');
    setShowMyReports(false);
    setSearchQuery('');
    setSelectedReport(null);
  };

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
          onViewMatch={(r) => setSelectedReport(r)} 
          onCompare={(item1, item2) => {
             // We do NOT close the details here. App.tsx will overlay the comparator.
             onCompare(item1, item2);
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
                     Reconnect with what you’ve lost using visual AI.
                 </p>

                 {/* Under the Hood Button */}
                 <div className="pt-2 flex justify-center lg:justify-start animate-in slide-in-from-bottom-4 fade-in duration-700 delay-150">
                    <button 
                        onClick={() => onNavigate('FEATURES')}
                        className="group relative flex items-center gap-3 px-5 py-3 bg-[#0f172a]/50 hover:bg-[#0f172a] border border-white/10 hover:border-white/20 rounded-2xl transition-all duration-300 backdrop-blur-md"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-[#4285F4]/20 via-[#EA4335]/20 to-[#FBBC05]/20 opacity-0 group-hover:opacity-100 blur-xl transition-all duration-500"></div>
                        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#4285F4] via-[#EA4335] to-[#34A853] scale-x-0 group-hover:scale-x-100 transition-transform duration-500 ease-out origin-left"></div>

                        <div className="relative flex items-center gap-3">
                           <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-white/20 group-hover:bg-white/10 transition-colors shadow-inner">
                              <Cpu className="w-5 h-5 text-[#4285F4] group-hover:scale-110 transition-transform" />
                           </div>
                           <div className="text-left">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-1 group-hover:text-slate-300">Technical Deep Dive</p>
                              <p className="text-sm font-bold text-white leading-none">Under the Hood</p>
                           </div>
                        </div>
                    </button>
                 </div>
             </div>

             {/* Right Side - Buttons */}
             <div className="relative z-10 w-full max-w-sm flex flex-col gap-4">
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
             </div>
          </div>
      </section>

      {/* AI DISCOVERY HUB - Conditionally Rendered */}
      <AIDiscoveryHub user={user} reports={reports} onCompare={onCompare} />

      {/* Main Content Feed */}
      <section className="space-y-6">
         <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-center gap-4">
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <button 
                  onClick={handleHomeReset}
                  className="p-2.5 rounded-xl border bg-indigo-50 dark:bg-slate-800 border-indigo-200 dark:border-slate-700 text-indigo-600 hover:bg-indigo-100 dark:hover:bg-slate-700 transition-all shadow-sm"
                  title="Dashboard Home (Reset Filters)"
                >
                   <Home className="w-5 h-5" />
                </button>

                <div className="flex p-1 bg-off-white dark:bg-slate-800 rounded-xl shrink-0">
                   <button onClick={() => setActiveTab(ReportType.LOST)} className={`px-4 sm:px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === ReportType.LOST ? 'bg-white dark:bg-slate-700 text-orange-600 shadow-sm' : 'text-slate-500'}`}>Lost</button>
                   <button onClick={() => setActiveTab(ReportType.FOUND)} className={`px-4 sm:px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === ReportType.FOUND ? 'bg-white dark:bg-slate-700 text-teal-600 shadow-sm' : 'text-slate-500'}`}>Found</button>
                </div>
                
                <button 
                  onClick={() => setShowMyReports(!showMyReports)}
                  className={`p-2.5 rounded-xl border transition-all ${showMyReports 
                    ? 'bg-indigo-50 dark:bg-slate-800 border-indigo-200 dark:border-slate-700 text-indigo-600' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600'
                  }`}
                  title={showMyReports ? "Show All Reports" : "Show My Reports Only"}
                >
                   <UserIcon className="w-5 h-5" />
                </button>

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

         <div className="flex items-center gap-2 px-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {showMyReports ? 'My ' : ''}{viewStatus === 'RESOLVED' ? 'Resolved Archive' : 'Active Listings'}
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
                  <p className="font-bold">No {showMyReports ? 'personal' : ''} {viewStatus === 'RESOLVED' ? 'resolved' : 'active'} items found.</p>
                  <p className="text-xs mt-1">Try changing the category or search terms.</p>
               </div>
            )}
         </div>
      </section>
    </div>
  );
};

export default Dashboard;

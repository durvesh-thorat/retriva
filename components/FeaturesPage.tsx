
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BrainCircuit, ShieldCheck, Zap, Database, Eye, Fingerprint, Lock, ScanFace, Code2, Server, Cloud, Sparkles, Search, AlertTriangle, CheckCircle2, Siren, Box } from 'lucide-react';

interface FeaturesPageProps {
  onBack: () => void;
}

// --- ANIMATED DEMO COMPONENTS ---

const VisionDemo = () => {
  const [scanLine, setScanLine] = useState(0);
  const [dataVisible, setDataVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setScanLine(prev => (prev + 1) % 100);
    }, 30);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scanLine > 50) setDataVisible(true);
    if (scanLine < 10) setDataVisible(false);
  }, [scanLine]);

  return (
    <div className="relative w-full h-64 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex shadow-2xl">
       {/* Image Side */}
       <div className="w-1/2 relative bg-slate-800 overflow-hidden">
          <img 
            src="https://images.unsplash.com/photo-1605518216938-7f31b709d043?q=80&w=800&auto=format&fit=crop" 
            className="w-full h-full object-cover opacity-80" 
            alt="Lost Bottle"
          />
          {/* Scanning Line */}
          <div 
            className="absolute left-0 right-0 h-1 bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.8)] z-10"
            style={{ top: `${scanLine}%` }}
          ></div>
          <div className="absolute inset-0 bg-cyan-500/10 z-0" style={{ clipPath: `inset(0 0 ${100 - scanLine}% 0)` }}></div>
          
          {/* Bounding Boxes */}
          <div className={`absolute top-[30%] left-[30%] w-[40%] h-[50%] border-2 border-cyan-500/50 rounded-lg transition-opacity duration-300 ${dataVisible ? 'opacity-100' : 'opacity-0'}`}>
             <span className="absolute -top-5 left-0 text-[9px] bg-cyan-500 text-black font-bold px-1 rounded">CONFIDENCE: 99.8%</span>
          </div>
       </div>

       {/* Data Side */}
       <div className="w-1/2 p-4 font-mono text-[10px] text-cyan-400 bg-slate-950 overflow-hidden relative">
          <div className="absolute top-2 right-2 flex gap-1">
             <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
             <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse delay-75"></div>
             <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse delay-150"></div>
          </div>
          <div className={`transition-all duration-500 ${dataVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
             <p className="text-slate-500 mb-2">// Gemini 3.0 Extraction</p>
             <p><span className="text-purple-400">const</span> item = {'{'}</p>
             <p className="pl-2">category: <span className="text-green-400">"Drinkware"</span>,</p>
             <p className="pl-2">color: <span className="text-green-400">"Navy Blue"</span>,</p>
             <p className="pl-2">brand: <span className="text-green-400">"Hydroflask"</span>,</p>
             <p className="pl-2">condition: <span className="text-green-400">"Dented"</span>,</p>
             <p className="pl-2">features: [</p>
             <p className="pl-4"><span className="text-green-400">"Sticker on side"</span>,</p>
             <p className="pl-4"><span className="text-green-400">"Metal cap"</span></p>
             <p className="pl-2">]</p>
             <p>{'};'}</p>
          </div>
       </div>
    </div>
  );
};

const MatchingDemo = () => {
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<'scanning' | 'found'>('scanning');

  useEffect(() => {
    const interval = setInterval(() => {
       if (phase === 'scanning') {
          // Random fluctuation
          setScore(Math.floor(Math.random() * 50));
       } else {
          // Count up to 98
          setScore(prev => prev < 98 ? prev + 2 : 98);
       }
    }, 50);

    const phaseTimer = setInterval(() => {
       setPhase(prev => prev === 'scanning' ? 'found' : 'scanning');
    }, 4000);

    return () => { clearInterval(interval); clearInterval(phaseTimer); };
  }, [phase]);

  return (
     <div className="relative w-full h-64 bg-slate-900 rounded-2xl border border-slate-800 p-6 flex items-center justify-between shadow-2xl overflow-hidden">
        
        {/* Background Grid */}
        <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:20px_20px]"></div>

        {/* Item A */}
        <div className="relative z-10 w-24 h-32 bg-slate-800 rounded-xl border border-slate-700 p-3 flex flex-col items-center gap-2 shadow-lg group">
           <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
              <Search className="w-6 h-6 text-orange-500" />
           </div>
           <div className="text-center">
              <div className="text-[9px] text-slate-400 font-bold">QUERY</div>
              <div className="text-[10px] text-white font-bold">Lost Keys</div>
           </div>
           {/* Vector Representation */}
           <div className="absolute -right-4 top-1/2 w-4 h-[1px] bg-slate-700"></div>
        </div>

        {/* The Brain / Core */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
           <div className={`text-4xl font-black tracking-tighter transition-all duration-300 ${phase === 'found' ? 'text-emerald-400 scale-110' : 'text-slate-600'}`}>
              {score}%
           </div>
           <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-2">
              Semantic Similarity
           </div>
           {/* Connecting Lines */}
           <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700 to-transparent mt-4 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-shimmer-fast"></div>
           </div>
        </div>

        {/* Item B */}
        <div className={`relative z-10 w-24 h-32 bg-slate-800 rounded-xl border p-3 flex flex-col items-center gap-2 shadow-lg transition-all duration-500 ${phase === 'found' ? 'border-emerald-500/50 shadow-emerald-500/20 scale-105' : 'border-slate-700 opacity-50'}`}>
           <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center">
              <Box className="w-6 h-6 text-teal-500" />
           </div>
           <div className="text-center">
              <div className="text-[9px] text-slate-400 font-bold">CANDIDATE</div>
              <div className="text-[10px] text-white font-bold">Keychain</div>
           </div>
           {/* Match Badge */}
           {phase === 'found' && (
              <div className="absolute -top-3 -right-3 bg-emerald-500 text-slate-900 text-[9px] font-black px-2 py-0.5 rounded-full animate-bounce">
                 MATCH
              </div>
           )}
        </div>

     </div>
  );
};

const SecurityDemo = () => {
   const [status, setStatus] = useState<'scanning' | 'blurring' | 'safe'>('scanning');

   useEffect(() => {
      const timer = setInterval(() => {
         setStatus(prev => {
            if (prev === 'scanning') return 'blurring';
            if (prev === 'blurring') return 'safe';
            return 'scanning';
         });
      }, 2500);
      return () => clearInterval(timer);
   }, []);

   return (
      <div className="relative w-full h-64 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col items-center justify-center shadow-2xl overflow-hidden">
         {/* ID Card Simulation */}
         <div className="relative w-48 h-32 bg-slate-100 rounded-xl p-3 shadow-lg flex gap-3 overflow-hidden">
             {/* Avatar Area - The sensitive part */}
             <div className={`w-12 h-16 bg-slate-300 rounded-md transition-all duration-500 relative overflow-hidden ${status !== 'scanning' ? 'blur-md grayscale' : ''}`}>
                 <div className="absolute top-2 left-2 w-2 h-2 bg-slate-400 rounded-full"></div>
                 <div className="absolute bottom-0 left-1 right-1 h-6 bg-slate-400 rounded-t-lg"></div>
                 {/* Redaction Overlay */}
                 {status !== 'scanning' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                       <Lock className="w-4 h-4 text-slate-800" />
                    </div>
                 )}
             </div>
             
             {/* Text Lines */}
             <div className="flex-1 space-y-2">
                <div className="h-2 w-20 bg-slate-300 rounded"></div>
                <div className="h-2 w-16 bg-slate-200 rounded"></div>
                <div className={`h-2 w-24 bg-slate-300 rounded transition-all duration-500 ${status !== 'scanning' ? 'blur-[2px] opacity-50' : ''}`}></div>
             </div>

             {/* Scanner Bar */}
             {status === 'scanning' && (
               <div className="absolute top-0 left-0 right-0 h-full bg-gradient-to-b from-indigo-500/20 to-transparent animate-slide-up pointer-events-none border-b-2 border-indigo-500"></div>
             )}
         </div>

         {/* Status Indicators */}
         <div className="mt-6 flex gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${status === 'scanning' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
               <ScanFace className={`w-3 h-3 ${status === 'scanning' ? 'animate-pulse' : ''}`} />
               <span className="text-[10px] font-bold">SCANNING</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${status === 'blurring' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
               <AlertTriangle className={`w-3 h-3 ${status === 'blurring' ? 'animate-bounce' : ''}`} />
               <span className="text-[10px] font-bold">PII DETECTED</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${status === 'safe' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
               <CheckCircle2 className="w-3 h-3" />
               <span className="text-[10px] font-bold">SAFE</span>
            </div>
         </div>
      </div>
   );
};

// --- MAIN PAGE ---

const TechCard = ({ icon: Icon, title, desc, color }: { icon: any, title: string, desc: string, color: string }) => (
  <div className="group relative p-6 bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:bg-white/10 transition-all duration-300">
     <div className={`absolute top-0 right-0 p-20 opacity-10 bg-gradient-to-br ${color} blur-[60px] group-hover:opacity-20 transition-opacity`}></div>
     <div className="relative z-10">
        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
           <Icon className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed font-medium">{desc}</p>
     </div>
  </div>
);

const FeatureSection = ({ align, title, subtitle, desc, icon: Icon, color, VisualComponent }: { align: 'left' | 'right', title: string, subtitle: string, desc: string, icon: any, color: string, VisualComponent: React.ComponentType }) => (
  <div className={`flex flex-col lg:flex-row items-center gap-12 lg:gap-20 py-20 ${align === 'right' ? 'lg:flex-row-reverse' : ''}`}>
     <div className="flex-1 space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-widest text-slate-300">
           <Icon className={`w-4 h-4 ${color}`} />
           <span>{subtitle}</span>
        </div>
        
        <div>
           <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-[1.1] mb-6">
              {title}
           </h2>
           <p className="text-lg text-slate-400 font-medium leading-relaxed max-w-xl">
              {desc}
           </p>
        </div>

        {/* Technical Callout */}
        <div className="p-5 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden group">
           <div className={`absolute top-0 left-0 w-1 h-full bg-gradient-to-b ${color}`}></div>
           <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
              <Code2 className="w-3 h-3 text-slate-400" /> How it works
           </h4>
           <p className="text-xs text-slate-400 leading-relaxed font-mono">
              The system utilizes <strong>Gemini 3.0 Multimodal embeddings</strong> to convert raw input into high-dimensional vectors. This allows us to perform cosine similarity searches across millions of data points in milliseconds.
           </p>
        </div>
     </div>

     {/* Visual Side */}
     <div className="flex-1 w-full relative group">
        <div className={`absolute -inset-1 bg-gradient-to-r ${color} rounded-[2rem] opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-700`}></div>
        <div className="relative rounded-[2rem] bg-slate-950 border border-slate-800 p-2 shadow-2xl">
           <VisualComponent />
        </div>
     </div>
  </div>
);

const FeaturesPage: React.FC<FeaturesPageProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-[#020617] text-slate-50 overflow-x-hidden selection:bg-indigo-500/30">
       
       {/* Global Background Effects */}
       <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] bg-indigo-900/10 rounded-full blur-[120px] animate-pulse-soft"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-purple-900/10 rounded-full blur-[120px] animate-pulse-soft" style={{ animationDelay: '2s' }}></div>
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03]"></div>
       </div>

       <div className="relative z-10 max-w-7xl mx-auto px-6 pb-20">
          
          {/* Navigation */}
          <nav className="py-6 flex justify-between items-center animate-in slide-in-from-top-4 duration-700">
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                   <Zap className="w-6 h-6" />
                </div>
                <span className="font-black text-xl tracking-tight">RETRIVA <span className="text-indigo-500">INSIGHTS</span></span>
             </div>
             <button 
               onClick={onBack}
               className="group flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all font-bold text-xs uppercase tracking-widest text-slate-300 hover:text-white"
             >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to App
             </button>
          </nav>

          {/* Hero Section */}
          <header className="py-20 lg:py-32 text-center max-w-4xl mx-auto space-y-8 animate-in zoom-in-95 duration-700">
             <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-black uppercase tracking-widest mb-4">
                <Sparkles className="w-3.5 h-3.5" /> Powered by Gemini 3.0 Flash
             </div>
             
             <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-[0.9]">
                The Future of <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400 animate-gradient-slow">Intelligent Recovery.</span>
             </h1>
             
             <p className="text-xl text-slate-400 font-medium leading-relaxed max-w-2xl mx-auto">
                We replaced standard database queries with multimodal reasoning. Retriva doesn't just store items; it understands them.
             </p>
          </header>

          {/* Core Tech Grid */}
          <section className="mb-32">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <TechCard 
                  icon={BrainCircuit}
                  title="Gemini 3.0"
                  desc="Latest multimodal reasoning model for Vision and Semantic tasks."
                  color="from-blue-600 to-cyan-600"
                />
                <TechCard 
                  icon={Database}
                  title="Vector Search"
                  desc="High-dimensional embedding comparison for fuzzy matching."
                  color="from-purple-600 to-pink-600"
                />
                <TechCard 
                  icon={ShieldCheck}
                  title="Auto-Moderation"
                  desc="Real-time scanning for PII, gore, and spam content."
                  color="from-emerald-600 to-teal-600"
                />
                <TechCard 
                  icon={Cloud}
                  title="Real-time Sync"
                  desc="Instant updates across all devices via Firebase Firestore."
                  color="from-orange-600 to-red-600"
                />
             </div>
          </section>

          {/* DEEP DIVES WITH ANIMATIONS */}
          <div className="space-y-24 border-t border-white/5 pt-20">
             
             {/* Feature 1: Vision Ingestion */}
             <FeatureSection 
               align="left"
               title="Pixel-to-Data Conversion."
               subtitle="Vision Intelligence"
               desc="When you snap a photo, Gemini 3.0 doesn't just see pixels. It extracts structured data: precise color codes, brand recognition, material analysis, and damage assessment. This turns a raw image into a searchable database entry automatically."
               icon={Eye}
               color="from-cyan-500 to-blue-600"
               VisualComponent={VisionDemo}
             />

             {/* Feature 2: Semantic Matching */}
             <FeatureSection 
               align="right"
               title="It matches meaning, not just keywords."
               subtitle="Semantic Engine"
               desc="Traditional search fails when a user types 'Phone' but the item is listed as 'iPhone 14'. Our Semantic Match Engine calculates vector similarity. It knows that 'Keys' and 'Keychain' are contextually related, even if the words don't match exactly."
               icon={Fingerprint}
               color="from-indigo-500 to-purple-600"
               VisualComponent={MatchingDemo}
             />

             {/* Feature 3: Security */}
             <FeatureSection 
               align="left"
               title="Privacy is not optional."
               subtitle="The Guardian AI"
               desc="Campus lost & founds are full of sensitive items like Student IDs and Credit Cards. Our Guardian AI scans every upload in real-time. If it detects PII, it automatically blurs the sensitive regions before the image is public."
               icon={ShieldCheck}
               color="from-emerald-500 to-teal-600"
               VisualComponent={SecurityDemo}
             />

             {/* Feature 4: Proactive Scan (Text Only for balance) */}
             <div className="flex flex-col items-center text-center py-20 bg-gradient-to-b from-white/5 to-transparent rounded-[3rem] border border-white/10 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
                
                <div className="p-4 bg-indigo-500/20 rounded-full mb-6 animate-pulse-soft">
                   <Siren className="w-8 h-8 text-indigo-400" />
                </div>
                
                <h2 className="text-3xl md:text-4xl font-black text-white mb-4">Proactive Scan & Alert</h2>
                <p className="text-slate-400 max-w-2xl mx-auto text-lg leading-relaxed mb-8">
                   You don't need to check the app every hour. Our backend runs a <strong>Cron Job</strong> that periodically cross-references your lost item report against all new incoming found items. If a potential match (Confidence &gt; 85%) is found, we send you a push notification instantly.
                </p>

                <div className="flex flex-wrap justify-center gap-4">
                   <div className="px-4 py-2 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono text-purple-400">
                      Background Process
                   </div>
                   <div className="px-4 py-2 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono text-purple-400">
                      Push Notifications
                   </div>
                   <div className="px-4 py-2 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono text-purple-400">
                      RAG Pipeline
                   </div>
                </div>
             </div>

          </div>

          {/* Team Section */}
          <section className="mt-32 pt-20 border-t border-white/5">
             <div className="text-center mb-16">
               <h2 className="text-4xl font-black text-white mb-4">The Team</h2>
               <p className="text-slate-400">The minds behind the machine.</p>
             </div>
             
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                   { name: "Teammate 1", role: "Full Stack Engineer", icon: Code2, bgClass: "bg-indigo-500/20", hoverBgClass: "group-hover:bg-indigo-500", iconColorClass: "text-indigo-300", roleColorClass: "text-indigo-400" },
                   { name: "Teammate 2", role: "AI Specialist", icon: BrainCircuit, bgClass: "bg-purple-500/20", hoverBgClass: "group-hover:bg-purple-500", iconColorClass: "text-purple-300", roleColorClass: "text-purple-400" },
                   { name: "Teammate 3", role: "Product Designer", icon: Sparkles, bgClass: "bg-pink-500/20", hoverBgClass: "group-hover:bg-pink-500", iconColorClass: "text-pink-300", roleColorClass: "text-pink-400" },
                   { name: "Teammate 4", role: "Backend Architect", icon: Server, bgClass: "bg-emerald-500/20", hoverBgClass: "group-hover:bg-emerald-500", iconColorClass: "text-emerald-300", roleColorClass: "text-emerald-400" },
                ].map((member, i) => (
                  <div key={i} className="group relative bg-white/5 border border-white/10 rounded-3xl p-8 hover:-translate-y-2 transition-transform duration-300">
                     <div className={`w-20 h-20 mx-auto ${member.bgClass} rounded-full mb-6 flex items-center justify-center ${member.hoverBgClass} transition-colors`}>
                        <member.icon className={`w-10 h-10 ${member.iconColorClass} group-hover:text-white`} />
                     </div>
                     <h3 className="text-xl font-bold text-white mb-1">{member.name}</h3>
                     <p className={`text-xs font-bold ${member.roleColorClass} uppercase tracking-widest`}>{member.role}</p>
                  </div>
                ))}
             </div>
          </section>

          {/* Bottom CTA */}
          <div className="mt-32 text-center">
             <button 
               onClick={onBack}
               className="inline-flex items-center gap-3 px-10 py-5 bg-white text-slate-900 rounded-full font-black text-xl hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.3)] transition-all"
             >
                Start Using Retriva <ArrowRight className="w-6 h-6" />
             </button>
          </div>

       </div>
    </div>
  );
};

export default FeaturesPage;

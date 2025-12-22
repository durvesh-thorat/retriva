import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { Loader2, ArrowRight, Eye, EyeOff, AlertCircle, Mail, Lock, User as UserIcon, BrainCircuit, Search, ShieldCheck, LockKeyhole, Cpu, Zap, Activity } from 'lucide-react';
import { auth, db, googleProvider } from '../services/firebase';

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
          name: firebaseUser.displayName || name || 'Student',
          email: firebaseUser.email || email || '',
          studentId: '', 
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
    setDebugInfo(null);
    
    try {
      // 1. Try Popup first (Better UX)
      const result = await auth.signInWithPopup(googleProvider);
      await processLogin(result.user);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
          console.log("Google Sign-In cancelled by user");
          setIsGoogleLoading(false);
          return;
      }

      // 2. Fallback to Redirect if Popup fails
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmailLoading || isGoogleLoading) return;

    setIsEmailLoading(true);
    setError(null);
    setDebugInfo(null);
    
    try {
      if (isLogin) {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        if (userCredential.user) {
           await processLogin(userCredential.user);
        }
      } else {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const firebaseUser = userCredential.user;
        if (firebaseUser) {
          await firebaseUser.updateProfile({ displayName: name });
          await processLogin(firebaseUser);
        }
      }
    } catch (err: any) {
      handleAuthError(err);
      setIsEmailLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-white dark:bg-slate-950">
      
      {/* Left Side - Branding / Features */}
      <div className="md:w-1/2 lg:w-5/12 bg-slate-50 dark:bg-slate-900 p-8 flex flex-col justify-between relative overflow-hidden">
         {/* Background Orbs */}
         <div className="absolute top-[-20%] left-[-20%] w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-purple-500/20 rounded-full blur-[100px] pointer-events-none"></div>

         <div className="relative z-10">
            <div className="flex items-center gap-2 mb-8">
               <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                  <BrainCircuit className="w-6 h-6" />
               </div>
               <span className="font-black text-xl tracking-tight text-slate-900 dark:text-white">RETRIVA</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-[1.1] mb-6">
               Lost it? <br />
               <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600">Consider it found.</span>
            </h1>
            
            <p className="text-lg text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-md">
               The intelligent campus lost & found powered by Gemini AI. Upload a photo, and let our vision model do the matching.
            </p>

            <div className="mt-10 space-y-4">
                <div className="flex items-center gap-4 p-4 bg-white/60 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm">
                   <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                      <Search className="w-5 h-5" />
                   </div>
                   <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm">Visual Search</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Find items by image, not just keywords.</p>
                   </div>
                </div>
                
                <div className="flex items-center gap-4 p-4 bg-white/60 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm">
                   <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="w-5 h-5" />
                   </div>
                   <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm">Privacy Guard</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Auto-redaction of PII on IDs and documents.</p>
                   </div>
                </div>
            </div>
         </div>

         <div className="relative z-10 mt-8 md:mt-0">
             <button onClick={onShowFeatures} className="text-sm font-bold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-white flex items-center gap-2 transition-colors">
                <Cpu className="w-4 h-4" /> See how it works <ArrowRight className="w-4 h-4" />
             </button>
         </div>
      </div>

      {/* Right Side - Auth Form */}
      <div className="md:w-1/2 lg:w-7/12 flex items-center justify-center p-6 md:p-12">
         <div className="w-full max-w-md space-y-8">
            
            <div className="text-center md:text-left">
               <h2 className="text-2xl font-black text-slate-900 dark:text-white">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
               <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
                  {isLogin ? "Enter your credentials to access your dashboard." : "Join the network to start reporting items."}
               </p>
            </div>

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex gap-3 items-start animate-in slide-in-from-top-2">
                 <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                 <div className="flex-1">
                    <p className="text-sm font-bold text-red-800 dark:text-red-300">{error}</p>
                    {debugInfo && (
                       <div className="mt-2 text-[10px] bg-red-100 dark:bg-red-900/40 p-2 rounded text-red-800 dark:text-red-200 font-mono break-all">
                          Domain: {debugInfo.domain}<br/>
                          Project: {debugInfo.projectId}<br/>
                          Needs "Authorized Domain" in Firebase Console.
                       </div>
                    )}
                 </div>
              </div>
            )}

            <div className="space-y-4">
               <button 
                 onClick={handleGoogleLogin} 
                 disabled={isGoogleLoading || isEmailLoading}
                 className="w-full py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-3 shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
               >
                  {isGoogleLoading ? (
                     <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  ) : (
                     <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  )}
                  <span>Continue with Google</span>
               </button>

               <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-slate-800"></div></div>
                  <div className="relative flex justify-center"><span className="bg-white dark:bg-slate-950 px-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Or with Email</span></div>
               </div>

               <form onSubmit={handleSubmit} className="space-y-4">
                  {!isLogin && (
                     <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Full Name</label>
                        <div className="relative">
                           <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                           <input 
                              type="text" 
                              required 
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder="John Doe"
                              className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                           />
                        </div>
                     </div>
                  )}

                  <div className="space-y-1.5">
                     <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email Address</label>
                     <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                           type="email" 
                           required 
                           value={email}
                           onChange={(e) => setEmail(e.target.value)}
                           placeholder="you@university.edu"
                           className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                        />
                     </div>
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-xs font-bold text-slate-500 uppercase ml-1">Password</label>
                     <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                           type={showPassword ? "text" : "password"} 
                           required 
                           value={password}
                           onChange={(e) => setPassword(e.target.value)}
                           placeholder="••••••••"
                           minLength={6}
                           className="w-full pl-11 pr-12 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                           {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                     </div>
                  </div>

                  <button 
                     type="submit" 
                     disabled={isEmailLoading || isGoogleLoading}
                     className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                     {isEmailLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                     {isLogin ? "Sign In" : "Create Account"}
                     {!isEmailLoading && <ArrowRight className="w-4 h-4" />}
                  </button>
               </form>

               <div className="text-center pt-2">
                  <p className="text-sm text-slate-500">
                     {isLogin ? "Don't have an account?" : "Already have an account?"}
                     <button 
                        onClick={() => { setIsLogin(!isLogin); setError(null); }} 
                        className="ml-1.5 font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                     >
                        {isLogin ? "Sign up" : "Log in"}
                     </button>
                  </p>
               </div>
            </div>

            <div className="pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
               <button onClick={onShowLegal} className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center justify-center gap-1.5 mx-auto">
                  <ShieldCheck className="w-3.5 h-3.5" /> Privacy & Terms
               </button>
            </div>

         </div>
      </div>
    </div>
  );
};

export default Auth;

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import ReportForm from './components/ReportForm';
import ChatView from './components/ChatView';
import Profile from './components/Profile';
import Toast from './components/Toast';
import NotificationCenter from './components/NotificationCenter';
import MatchComparator from './components/MatchComparator';
import FeaturesPage from './components/FeaturesPage';
import AIDisclaimerModal from './components/AIDisclaimerModal';
import { User, ViewState, ItemReport, ReportType, ItemCategory, AppNotification, Chat, Message } from './types';
import { MessageCircle, Bell, Moon, Sun, User as UserIcon, Plus, SearchX, Box, Loader2 } from 'lucide-react';

// FIREBASE IMPORTS
import { auth, db, FieldValue } from './services/firebase';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true); // Loading state for initial auth check

  const [view, setView] = useState<ViewState>('AUTH');
  const [reports, setReports] = useState<ItemReport[]>([]);
  const [editingReport, setEditingReport] = useState<ItemReport | null>(null);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'info' | 'alert'} | null>(null);
  
  // Persistent Dark Mode
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('retriva_theme');
    return saved ? JSON.parse(saved) : false; // Default to light mode or use system pref if desired
  });
  
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [comparingItems, setComparingItems] = useState<{item1: ItemReport, item2: ItemReport} | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  // NEW: Listen for system-wide Toast Events (e.g. from GeminiService)
  useEffect(() => {
    const handleToastEvent = (e: any) => {
        if (e.detail) setToast(e.detail);
    };
    // @ts-ignore - Custom event is not in WindowEventMap
    window.addEventListener('retriva-toast', handleToastEvent);
    // @ts-ignore
    return () => window.removeEventListener('retriva-toast', handleToastEvent);
  }, []);

  // 1. AUTH LISTENER: Persist Login & Presence
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        // Fetch full profile from Firestore
        const userDocRef = db.collection('users').doc(firebaseUser.uid);
        try {
          const userSnap = await userDocRef.get();
          if (userSnap.exists) {
             setUser(userSnap.data() as User);
             // Set Online
             userDocRef.update({ isOnline: true, lastSeen: Date.now() });
          } else {
             // Basic fallback
             const fallbackUser = {
               id: firebaseUser.uid,
               name: firebaseUser.displayName || 'User',
               email: firebaseUser.email || '',
               isVerified: false
             };
             setUser(fallbackUser);
             userDocRef.set({ ...fallbackUser, isOnline: true, lastSeen: Date.now() });
          }

          // RESTORE PREVIOUS STATE (View & Active Chat)
          const savedView = localStorage.getItem('retriva_view') as ViewState;
          const savedChatId = localStorage.getItem('retriva_active_chat');

          if (savedView && savedView !== 'AUTH') {
             setView(savedView);
             if (savedView === 'MESSAGES' && savedChatId) {
                setActiveChatId(savedChatId);
             }
          } else {
             setView('DASHBOARD');
          }

        } catch (e) {
          console.error("Error fetching user profile", e);
        }
      } else {
        setUser(null);
        setView('AUTH');
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []); 

  // PERSISTENCE EFFECT: Save View & Chat ID
  useEffect(() => {
    if (view !== 'AUTH') {
        localStorage.setItem('retriva_view', view);
    }
  }, [view]);

  useEffect(() => {
    if (activeChatId) {
        localStorage.setItem('retriva_active_chat', activeChatId);
    } else {
        localStorage.removeItem('retriva_active_chat');
    }
  }, [activeChatId]);

  // Presence Heartbeat
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
        db.collection('users').doc(user.id).update({ lastSeen: Date.now(), isOnline: true });
    }, 60000); // Every minute

    const handleDisconnect = () => {
        if (user) {
            // Best effort attempt to set offline
            navigator.sendBeacon('/api/offline', JSON.stringify({ uid: user.id }));
        }
    };
    window.addEventListener('beforeunload', handleDisconnect);
    return () => {
        clearInterval(interval);
        window.removeEventListener('beforeunload', handleDisconnect);
    }
  }, [user]);

  // 2. REALTIME REPORTS LISTENER
  useEffect(() => {
    // Only subscribe if we are logged in
    if (!user) return;

    const reportsRef = db.collection('reports').orderBy('createdAt', 'desc');

    const unsubscribe = reportsRef.onSnapshot((snapshot) => {
      const liveReports = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ItemReport[];
      
      setReports(liveReports);
    }, (error) => {
      console.error("Error fetching reports:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. REALTIME CHATS LISTENER (Global + Private)
  useEffect(() => {
    if (!user) return;

    // A. Ensure Global Chat Exists
    const globalChatRef = db.collection('chats').doc('global');
    globalChatRef.get().then(snap => {
      if (!snap.exists) {
        globalChatRef.set({
          id: 'global',
          type: 'global',
          itemTitle: 'Campus Community',
          participants: [],
          messages: [],
          lastMessage: 'Welcome to the community hub!',
          lastMessageTime: Date.now(),
          unreadCount: 0
        });
      }
    });

    // B. Listen to Global Chat
    const unsubGlobal = globalChatRef.onSnapshot((docSnap) => {
      if (docSnap.exists) {
        const globalData = docSnap.data() as Chat;
        setChats(prev => {
          const filtered = prev.filter(c => c.id !== 'global');
          return [globalData, ...filtered];
        });
      }
    });

    // C. Listen to My Chats
    const q = db.collection('chats').where('participants', 'array-contains', user.id);
    const unsubPrivate = q.onSnapshot((snapshot) => {
      const privateChats = snapshot.docs.map(d => d.data() as Chat);
      setChats(prev => {
         const global = prev.find(c => c.id === 'global');
         const all = global ? [global, ...privateChats] : privateChats;
         
         // Deduplicate & Filter deleted
         const uniqueMap = new Map();
         all.forEach(c => {
             // Filter out if user deleted it locally
             if (c.deletedIds && c.deletedIds.includes(user.id)) return;
             uniqueMap.set(c.id, c);
         });

         const unique = Array.from(uniqueMap.values());
         // Sort: Global first, then newest
         return unique.sort((a,b) => {
             if (a.type === 'global') return -1;
             if (b.type === 'global') return 1;
             return b.lastMessageTime - a.lastMessageTime;
         });
      });
    });

    return () => {
      unsubGlobal();
      unsubPrivate();
    };
  }, [user]);

  // THEME EFFECT
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('retriva_theme', JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
     setAvatarError(false);
  }, [user?.avatar]);

  const addNotification = useCallback((title: string, message: string, type: AppNotification['type'] = 'system', link?: ViewState) => {
    const newNotif: AppNotification = { id: crypto.randomUUID(), title, message, type, timestamp: Date.now(), isRead: false, link };
    setNotifications(prev => [newNotif, ...prev]);
    setToast({ message: message, type: type === 'match' ? 'alert' : type === 'message' ? 'info' : 'success' });
  }, []);

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    // Don't force DASHBOARD here, Auth Listener handles view restoration
    db.collection('users').doc(loggedInUser.id).update({ isOnline: true, lastSeen: Date.now() });
    setTimeout(() => addNotification('Welcome!', `Logged in as ${loggedInUser.name}`, 'system'), 1000);
  };

  const handleLogout = async () => {
    try {
      if (user) {
        await db.collection('users').doc(user.id).update({ isOnline: false, lastSeen: Date.now() });
      }
      await auth.signOut();
      
      // Clear Local Storage State
      localStorage.removeItem('retriva_view');
      localStorage.removeItem('retriva_active_chat');
      // We keep 'retriva_theme' as user preference usually persists per device

      setUser(null);
      setView('AUTH');
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (!window.confirm("Are you sure? This will delete all your reports and remove you from chats.")) return;

    setAuthLoading(true);
    try {
        const batch = db.batch();

        // 1. Delete Reports (Optimistic UI update)
        setReports(prev => prev.filter(r => r.reporterId !== user.id));
        
        // 2. Remove user from Chats (Handled by backend triggers usually, soft delete here)
        
        // 3. Delete User Doc
        batch.delete(db.collection('users').doc(user.id));
        
        // Commit batch
        await batch.commit();

        // 4. Auth Delete
        await auth.currentUser?.delete();
        
        // Clear storage
        localStorage.removeItem('retriva_view');
        localStorage.removeItem('retriva_active_chat');

        setUser(null);
        setView('AUTH');
        setToast({ message: "Account deleted.", type: 'info' });
    } catch (e) {
        console.error("Delete account error", e);
        setToast({ message: "Error deleting account. Re-login and try again.", type: 'alert' });
    } finally {
        setAuthLoading(false);
    }
  };

  const handleReportSubmit = async (report: ItemReport) => {
    try {
      if (editingReport) {
        // UPDATE Existing Report
        const reportRef = db.collection('reports').doc(report.id);
        const { id, ...reportData } = report;
        await reportRef.update(reportData as any);
        
        setEditingReport(null);
        addNotification('Updated', 'Report updated successfully.', 'system');
      } else {
        await db.collection('reports').doc(report.id).set(report);
        addNotification('Posted', 'Your report is now live.', 'system');
      }
      setView('DASHBOARD');
      setShowFabMenu(false);
    } catch (e) {
      console.error("Error saving report:", e);
      setToast({ message: "Failed to save report.", type: 'alert' });
    }
  };

  const handleDeleteReport = async (id: string) => {
    try {
      await db.collection('reports').doc(id).delete();
      setToast({ message: "Report deleted.", type: 'info' });
    } catch (e) {
      console.error("Error deleting:", e);
      setToast({ message: "Could not delete report.", type: 'alert' });
    }
  };

  const handleEditInit = (report: ItemReport) => {
    setEditingReport(report);
    setView(report.type === ReportType.LOST ? 'REPORT_LOST' : 'REPORT_FOUND');
  };

  const handleResolveReport = async (reportId: string) => {
    try {
      const reportRef = db.collection('reports').doc(reportId);
      await reportRef.update({ status: 'RESOLVED' });
      setToast({ message: "Item marked as resolved!", type: 'success' });
    } catch (e) {
      setToast({ message: "Update failed.", type: 'alert' });
    }
  };

  const handleCompare = (item1: ItemReport, item2: ItemReport) => {
    setComparingItems({ item1, item2 });
  };

  const handleChatStart = async (report: ItemReport) => {
    if (!user) return;
    
    if (!report.reporterId) {
       setToast({ message: "Cannot contact user (Missing ID).", type: 'alert' });
       return;
    }
    
    if (report.reporterId === user.id) {
        setToast({ message: "You cannot chat with yourself.", type: 'info' });
        return;
    }
    
    // Check if chat already exists
    const existingChat = chats.find(c => 
      c.type === 'direct' && 
      c.participants.includes(user.id) && 
      c.participants.includes(report.reporterId) &&
      c.itemId === report.id
    );
    
    if (existingChat) {
      setActiveChatId(existingChat.id);
      setView('MESSAGES');
      if (existingChat.deletedIds?.includes(user.id)) {
          db.collection('chats').doc(existingChat.id).update({
              deletedIds: FieldValue.arrayRemove(user.id)
          });
      }
    } else {
      const newChatId = crypto.randomUUID();
      const newChat: Chat = {
        id: newChatId,
        type: 'direct',
        itemId: report.id,
        itemTitle: report.title,
        itemImage: report.imageUrls[0] || '',
        participants: [user.id, report.reporterId],
        messages: [],
        lastMessage: 'Chat started',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        isBlocked: false,
        typing: {},
        deletedIds: []
      };
      
      try {
        await db.collection('chats').doc(newChatId).set(newChat);
        setActiveChatId(newChatId);
        setView('MESSAGES');
      } catch (e) {
        console.error("Error creating chat", e);
        setToast({ message: "Could not start chat.", type: 'alert' });
      }
    }
  };

  const handleBlockChat = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat || chat.type === 'global') return;

    try {
      const newStatus = !chat.isBlocked;
      await db.collection('chats').doc(chatId).update({
        isBlocked: newStatus,
        blockedBy: newStatus ? user?.id : null
      });
      setToast({ 
        message: newStatus ? "User blocked." : "User unblocked.", 
        type: newStatus ? 'alert' : 'success' 
      });
    } catch (e) {
      console.error("Block error", e);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
      if (!user) return;
      try {
          const chatRef = db.collection('chats').doc(chatId);
          await chatRef.update({
              deletedIds: FieldValue.arrayUnion(user.id)
          });
          if (activeChatId === chatId) setActiveChatId(null);
          setToast({ message: "Chat removed.", type: 'info' });
      } catch (e) {
          console.error(e);
      }
  };

  // LOADING SCREEN FOR AUTH CHECK
  if (authLoading) {
    return (
      <div className="fixed inset-0 bg-off-white dark:bg-slate-950 flex items-center justify-center">
         <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-brand-violet animate-spin" />
            <p className="text-slate-500 font-bold animate-pulse">Initializing Retriva...</p>
         </div>
      </div>
    );
  }

  // --- AUTH VIEW (Full Screen) ---
  if (!user) {
    return (
      <>
        <Auth onLogin={handleLogin} onShowLegal={() => setShowLegal(true)} />
        <AIDisclaimerModal isOpen={showLegal} onClose={() => setShowLegal(false)} />
      </>
    );
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const unreadMessageCount = chats.reduce((acc, chat) => {
    if (!user) return acc;
    const count = chat.messages.filter(m => m.senderId !== user.id && m.status !== 'read').length;
    return acc + count;
  }, 0);

  // --- MAIN APP CONTENT (Authenticated) ---
  const renderContent = () => {
    if (comparingItems) {
       return (
         <>
            <Dashboard 
              user={user} 
              reports={reports} 
              onNavigate={setView} 
              onResolve={handleResolveReport} 
              onDeleteReport={handleDeleteReport}
              onEditReport={handleEditInit}
              onCompare={handleCompare}
              onChatStart={handleChatStart}
            />
            <MatchComparator 
               item1={comparingItems.item1} 
               item2={comparingItems.item2} 
               onClose={() => setComparingItems(null)} 
               onContact={() => { setComparingItems(null); handleChatStart(comparingItems.item2); }}
            />
         </>
       );
    }

    switch (view) {
      case 'DASHBOARD': return (
        <Dashboard 
          user={user} 
          reports={reports} 
          onNavigate={setView} 
          onResolve={handleResolveReport} 
          onDeleteReport={handleDeleteReport}
          onEditReport={handleEditInit}
          onCompare={handleCompare}
          onChatStart={handleChatStart}
        />
      );
      case 'REPORT_LOST': 
      case 'REPORT_FOUND':
        return (
          <ReportForm 
            type={view === 'REPORT_LOST' ? ReportType.LOST : ReportType.FOUND} 
            user={user} 
            initialData={editingReport || undefined}
            onSubmit={handleReportSubmit} 
            onCancel={() => { setView('DASHBOARD'); setEditingReport(null); }} 
          />
        );
      case 'MESSAGES': return (
        <ChatView 
          user={user} 
          onBack={() => setView('DASHBOARD')} 
          onNotification={(t, b) => addNotification(t, b, 'message', 'MESSAGES')}
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={setActiveChatId}
          onBlockChat={handleBlockChat}
          onDeleteChat={handleDeleteChat}
        />
      );
      case 'PROFILE': return (
        <Profile 
          user={user} 
          onUpdate={setUser} 
          onBack={() => setView('DASHBOARD')} 
          onDeleteAccount={handleDeleteAccount}
          onLogout={handleLogout} 
        />
      );
      case 'FEATURES': return (
        <FeaturesPage onBack={() => setView('DASHBOARD')} />
      );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-off-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-300 flex flex-col">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* GLOBAL MODALS */}
      <AIDisclaimerModal isOpen={showLegal} onClose={() => setShowLegal(false)} />

      {/* Hide standard Nav if on Features Page for immersive effect, OR keep it. 
          The design prompt requested a "Brand New Page", implies fullscreen. 
          Let's conditionally hide the main nav if view === 'FEATURES' */}
      {view !== 'FEATURES' && (
        <nav className="sticky top-0 z-40 bg-off-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6">
            <div className="max-w-7xl mx-auto h-20 flex items-center justify-between py-3">
              <div className="flex items-center gap-10">
                <div className="flex items-center gap-4 cursor-pointer group" onClick={() => { setView('DASHBOARD'); setEditingReport(null); }}>
                  <div className="w-14 h-14 flex items-center justify-center group-hover:scale-110 transition-transform filter drop-shadow-lg relative z-10">
                     <svg viewBox="0 0 200 200" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <linearGradient id="pinGradientNav" x1="100" y1="25" x2="100" y2="190" gradientUnits="userSpaceOnUse">
                            <stop offset="0" stopColor="#6366f1" />
                            <stop offset="1" stopColor="#a855f7" />
                          </linearGradient>
                        </defs>
                        <g opacity="0.5">
                           <circle cx="100" cy="100" r="85" stroke="url(#pinGradientNav)" strokeWidth="2" strokeDasharray="10 10" strokeLinecap="round" />
                           <circle cx="100" cy="100" r="70" stroke="url(#pinGradientNav)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
                           <circle cx="185" cy="100" r="3" fill="#a855f7" />
                           <circle cx="15" cy="100" r="3" fill="#6366f1" />
                        </g>
                        <ellipse cx="100" cy="190" rx="20" ry="6" fill="#6366f1" opacity="0.3" />
                        <ellipse cx="100" cy="190" rx="10" ry="3" fill="#6366f1" opacity="0.5" />
                        <path fillRule="evenodd" clipRule="evenodd" d="M100 25 C60 25 25 60 25 100 C25 140 90 185 100 190 C110 185 175 140 175 100 C175 60 140 25 100 25 Z" fill="url(#pinGradientNav)" />
                        <circle cx="100" cy="100" r="42" fill="white" />
                        <g transform="translate(100 100)">
                          <path d="M0 -24 V24 M-24 0 H24" stroke="#7c3aed" strokeWidth="6" strokeLinecap="round" />
                          <path d="M-16 -16 L16 16 M16 -16 L-16 16" stroke="#7c3aed" strokeWidth="6" strokeLinecap="round" />
                          <circle r="7" fill="#7c3aed" />
                          <circle cx="0" cy="-30" r="4" fill="#7c3aed" />
                          <circle cx="0" cy="30" r="4" fill="#7c3aed" />
                          <circle cx="-30" cy="0" r="4" fill="#7c3aed" />
                          <circle cx="30" cy="0" r="4" fill="#7c3aed" />
                        </g>
                     </svg>
                  </div>
                  <div className="flex flex-col">
                     <span className="block font-black text-2xl tracking-tighter leading-none text-slate-900 dark:text-white">RETRIVA</span>
                     <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Campus Route & Connect</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                 <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 transition-colors">
                   {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                 </button>
                 <button onClick={() => setView('MESSAGES')} className={`relative p-2 rounded-full transition-all ${view === 'MESSAGES' ? 'bg-indigo-50 dark:bg-slate-800 text-indigo-600' : 'hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500'}`}>
                   <MessageCircle className="w-5 h-5" />
                   {unreadMessageCount > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-950"></span>}
                 </button>
                 <div className="relative">
                   <button onClick={() => setShowNotificationCenter(!showNotificationCenter)} className={`p-2 rounded-full transition-all ${showNotificationCenter ? 'bg-indigo-50 dark:bg-slate-800 text-indigo-600' : 'hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500'}`}>
                     <Bell className="w-5 h-5" />
                     {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-950"></span>}
                   </button>
                   {showNotificationCenter && <NotificationCenter notifications={notifications} onClose={() => setShowNotificationCenter(false)} onMarkAsRead={(id) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))} onMarkAllAsRead={() => setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))} onClearAll={() => { setNotifications([]); setShowNotificationCenter(false); }} onNavigate={(v) => { setView(v); setShowNotificationCenter(false); }} />}
                 </div>
                 <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>
                 <button onClick={() => setView('PROFILE')} className="flex items-center gap-3 pl-1 hover:opacity-80 transition-opacity">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-slate-800 overflow-hidden ring-2 ring-white dark:ring-slate-900 shadow-sm">
                       {user.avatar && !avatarError ? <img src={user.avatar} className="w-full h-full object-cover" onError={() => setAvatarError(true)} /> : <UserIcon className="w-full h-full p-2 text-indigo-300" />}
                    </div>
                 </button>
              </div>
            </div>
        </nav>
      )}

      {/* Main Container */}
      <main className={`flex-grow w-full mx-auto relative ${view === 'FEATURES' ? '' : 'p-4 md:p-6 max-w-[1400px]'}`}>
        {renderContent()}

        {/* FLOATING ACTION BUTTON (FAB) - Hide on Features Page */}
        {user && view !== 'AUTH' && view !== 'MESSAGES' && view !== 'FEATURES' && (
          <div className="fixed bottom-24 right-6 md:bottom-8 md:right-8 z-50 flex flex-col items-end gap-3">
             {showFabMenu && (
                <div className="flex flex-col items-end gap-5 mb-4 animate-in fade-in slide-in-from-bottom-8 zoom-in-90 duration-500 ease-out">
                   <button 
                     onClick={() => setView('REPORT_FOUND')}
                     className="group flex items-center gap-4 focus:outline-none transition-all"
                   >
                      <div className="px-5 py-2.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-[1.25rem] border border-teal-100 dark:border-teal-900/30 shadow-2xl opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0 duration-300 pointer-events-none group-hover:pointer-events-auto">
                         <span className="text-xs font-black text-teal-600 dark:text-teal-400 whitespace-nowrap tracking-wider uppercase">I found something</span>
                      </div>
                      <div className="w-14 h-14 bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-2xl border border-teal-100 dark:border-teal-900/20 flex items-center justify-center text-teal-500 transition-all group-hover:bg-teal-500 group-hover:text-white group-hover:scale-110 active:scale-90 group-hover:shadow-teal-500/40 group-hover:ring-8 group-hover:ring-teal-500/10">
                         <Box className="w-7 h-7" />
                      </div>
                   </button>
                   
                   <button 
                     onClick={() => setView('REPORT_LOST')}
                     className="group flex items-center gap-4 focus:outline-none transition-all"
                   >
                      <div className="px-5 py-2.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-[1.25rem] border border-orange-100 dark:border-orange-900/30 shadow-2xl opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0 duration-300 pointer-events-none group-hover:pointer-events-auto">
                         <span className="text-xs font-black text-orange-600 dark:text-orange-400 whitespace-nowrap tracking-wider uppercase">I lost something</span>
                      </div>
                      <div className="w-14 h-14 bg-white dark:bg-slate-900 rounded-[1.25rem] shadow-2xl border border-orange-100 dark:border-orange-900/20 flex items-center justify-center text-orange-500 transition-all group-hover:bg-orange-500 group-hover:text-white group-hover:scale-110 active:scale-90 group-hover:shadow-orange-500/40 group-hover:ring-8 group-hover:ring-orange-500/10">
                         <SearchX className="w-7 h-7" />
                      </div>
                   </button>
                </div>
             )}

             <button 
                onClick={() => setShowFabMenu(!showFabMenu)}
                className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all transform hover:scale-110 active:scale-95 relative overflow-hidden group
                   ${showFabMenu 
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-slate-900/40 dark:shadow-white/30 ring-8 ring-indigo-500/10' 
                      : 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-indigo-600/40 hover:shadow-indigo-500/60 ring-8 ring-indigo-500/0 hover:ring-indigo-500/10'
                   }
                `}
             >
                <div className={`absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`}></div>
                
                <div className={`transition-transform duration-500 ease-[cubic-bezier(0.68,-0.55,0.27,1.55)] ${showFabMenu ? 'rotate-[135deg]' : 'rotate-0'}`}>
                  <Plus className="w-9 h-9" />
                </div>
             </button>
          </div>
        )}
      </main>

      {view !== 'FEATURES' && (
        <footer className="w-full relative bg-white dark:bg-slate-950 mt-auto border-t border-slate-100 dark:border-slate-800">
            <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-60 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></div>
            <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3 text-[11px] font-medium text-slate-400">
              <div className="flex items-center gap-4">
                 <span>&copy; 2025 RETRIVA</span>
                 <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
                 <div className="flex gap-3">
                    <button onClick={() => setShowLegal(true)} className="hover:text-indigo-500 transition-colors">Privacy & Terms</button>
                 </div>
              </div>
              <div className="flex items-center gap-2">
                 <span className="opacity-60">Engineered by</span>
                 <span className="font-cursive text-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent hover:scale-105 transition-transform cursor-default">
                   4SCRIPT
                 </span>
              </div>
            </div>
        </footer>
      )}
    </div>
  );
};

export default App;

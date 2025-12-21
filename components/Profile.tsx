
import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types';
import { User as UserIcon, Mail, Building, Save, Camera, ArrowLeft, Loader2, Trash2, Edit3, AlertTriangle, LogOut } from 'lucide-react';
import { db, auth } from '../services/firebase';
import { uploadImage } from '../services/cloudinary';

interface ProfileProps {
  user: User;
  onUpdate: (updatedUser: User) => void;
  onBack: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
}

const Profile: React.FC<ProfileProps> = ({ user, onUpdate, onBack, onDeleteAccount, onLogout }) => {
  const [name, setName] = useState(user.name);
  const [department, setDepartment] = useState(user.department || '');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatarError(false);
  }, [avatar]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
         setAvatar(reader.result as string); // Preview with Base64
         setSelectedFile(file); // Store file for upload
         setAvatarError(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      // 1. Upload new Avatar if selected
      let finalAvatarUrl = avatar;
      if (selectedFile) {
         finalAvatarUrl = await uploadImage(selectedFile);
      }

      // 2. Update Firebase Auth Profile (Display Name ONLY)
      if (auth.currentUser) {
         await auth.currentUser.updateProfile({ 
            displayName: name
         });
      }

      // 3. Update Firestore Document
      const userRef = db.collection('users').doc(user.id);
      await userRef.set({
         name,
         department,
         avatar: finalAvatarUrl
      }, { merge: true });

      // 4. Update Local State
      onUpdate({ ...user, name, department, avatar: finalAvatarUrl });
      setSelectedFile(null); // Reset file selection
    } catch (e) {
      console.error("Error saving profile:", e);
      alert("Failed to save changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-24 animate-in slide-in-from-bottom-4 duration-500">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-white mb-6 font-bold text-xs uppercase tracking-widest transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Home
      </button>

      <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 overflow-hidden">
        {/* Header Banner - Smart/Deep Gradient */}
        <div className="h-40 bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 relative overflow-hidden">
           <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
           <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
        </div>

        <div className="px-8 pb-8 relative">
           {/* Avatar Section */}
           <div className="relative -mt-16 mb-6 flex flex-col items-center sm:items-start sm:flex-row sm:justify-between">
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                 <div className="w-32 h-32 rounded-full bg-white dark:bg-slate-900 border-[6px] border-white dark:border-slate-900 shadow-xl overflow-hidden flex items-center justify-center relative">
                   {avatar && !avatarError ? (
                     <img src={avatar} className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                   ) : (
                     <UserIcon className="w-12 h-12 text-slate-300 dark:text-slate-600" />
                   )}
                   {/* Overlay */}
                   <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-[1px]">
                      <Camera className="w-8 h-8 text-white mb-1" />
                      <span className="text-[9px] font-bold text-white uppercase tracking-wider">Change</span>
                   </div>
                 </div>
                 {/* Status Indicator */}
                 <div className="absolute bottom-2 right-2 w-6 h-6 bg-emerald-500 rounded-full border-4 border-white dark:border-slate-900 z-10"></div>
                 <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
              </div>

              {/* Remove Photo Button (Subtle) */}
              {avatar && (
                 <button 
                   type="button" 
                   onClick={() => { setAvatar(''); setSelectedFile(null); }} 
                   className="mt-4 sm:mt-0 sm:self-end px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors flex items-center gap-1.5"
                 >
                    <Trash2 className="w-3.5 h-3.5" /> Remove Photo
                 </button>
              )}
           </div>

           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 border-b border-slate-100 dark:border-slate-800 pb-8">
              <div>
                <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-1">{name}</h1>
                <p className="text-slate-500 text-sm font-medium flex items-center gap-2">
                   {user.studentId ? `Student ID: ${user.studentId}` : 'No Student ID Set'}
                   <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></span>
                   <span className="text-indigo-600 dark:text-indigo-400">{user.email}</span>
                </p>
              </div>
           </div>

           <form onSubmit={handleSubmit} className="space-y-6">
              
              <div className="grid grid-cols-1 gap-6">
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">Full Name</label>
                    <div className="relative">
                       <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full pl-4 pr-10 py-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
                       <Edit3 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                 </div>
                 
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">Major / Department</label>
                    <div className="relative">
                       <Building className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                       <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Computer Science" className="w-full pl-11 pr-4 py-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide ml-1">Email Address</label>
                    <div className="relative">
                       <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                       <input type="email" value={user.email} disabled className="w-full pl-11 pr-4 py-3.5 bg-slate-100 dark:bg-slate-800/30 border border-transparent rounded-xl text-sm font-semibold text-slate-500 cursor-not-allowed" />
                    </div>
                    <p className="text-[10px] text-slate-400 ml-1">Email address cannot be changed as it is linked to your university ID.</p>
                 </div>
              </div>

              {/* Form Footer Action */}
              <div className="pt-6 mt-6 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                 <button type="submit" disabled={isSaving} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-2 hover:shadow-lg hover:shadow-indigo-500/30 transition-all text-sm transform active:scale-95 disabled:opacity-70 disabled:transform-none">
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                 </button>
              </div>

           </form>
           
           {/* Account Actions */}
           <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-800">
               <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                   <AlertTriangle className="w-4 h-4" /> Account Actions
               </h3>
               
               <div className="space-y-4">
                  {/* Logout Row */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800">
                     <div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm">Sign Out</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Securely log out of your account on this device.</p>
                     </div>
                     <button 
                       onClick={onLogout}
                       className="px-5 py-2.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm flex items-center gap-2"
                     >
                        <LogOut className="w-4 h-4" /> Sign Out
                     </button>
                  </div>

                  {/* Delete Account Row */}
                  <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-900/20">
                      <div>
                          <h4 className="font-bold text-red-900 dark:text-red-200 text-sm">Delete Account</h4>
                          <p className="text-xs text-red-700/70 dark:text-red-300/60 mt-0.5">Permanently remove your profile and data.</p>
                      </div>
                      <button 
                        onClick={onDeleteAccount}
                        className="px-5 py-2.5 bg-white/50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-xs font-bold rounded-xl border border-red-200 dark:border-red-800 hover:bg-red-600 hover:text-white transition-colors shadow-sm"
                      >
                          Delete
                      </button>
                  </div>
               </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

// ------------------------------------------------------------------
// VERCEL DEPLOYMENT GUIDE:
// 1. Go to Vercel Project Settings -> Environment Variables.
// 2. Add the keys below (VITE_FIREBASE_API_KEY, etc.) with your new values.
// 3. Redeploy the project.
//
// NOTE: We use direct 'import.meta.env.KEY' access here. 
// This is required for Vite/Vercel to correctly replace the variables 
// during the production build optimization.
// ------------------------------------------------------------------

const firebaseConfig = {
  apiKey: (import.meta as any).env.VITE_FIREBASE_API_KEY,
  authDomain: (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: (import.meta as any).env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: (import.meta as any).env.VITE_FIREBASE_APP_ID,
  measurementId: (import.meta as any).env.VITE_FIREBASE_MEASUREMENT_ID
};

// Safety check to warn in console if keys are missing
if (!firebaseConfig.apiKey) {
  console.error("RETRIVA CRITICAL ERROR: Firebase API Key is missing.");
  console.error("If you are on Vercel, ensure you have added 'VITE_FIREBASE_API_KEY' in Settings > Environment Variables.");
}

if (!firebase.apps.length) {
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    console.error("Firebase Initialization Error:", e);
  }
}

export const auth = firebase.auth();
export const db = firebase.firestore();
export const googleProvider = new firebase.auth.GoogleAuthProvider();
export const FieldValue = firebase.firestore.FieldValue;

/**
 * Generates a globally unique Student ID in format YYYY-XXXXXXX.
 * Checks Firestore to ensure no collision.
 */
export const generateUniqueStudentId = async (): Promise<string> => {
  const currentYear = new Date().getFullYear();
  let isUnique = false;
  let newId = '';
  let attempts = 0;
  
  while (!isUnique && attempts < 10) {
    attempts++;
    // Generate 6 digit random number
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    newId = `${currentYear}-${randomNum}`;
    
    try {
        const snapshot = await db.collection('users').where('studentId', '==', newId).limit(1).get();
        if (snapshot.empty) {
            isUnique = true;
        }
    } catch (e) {
        console.error("Error checking student ID uniqueness", e);
        // In case of error, assume unique to proceed, or break to fallback
        if (attempts > 5) break; 
    }
  }
  
  // Final fallback if collision loop persists (extremely unlikely)
  if (!isUnique) {
      newId = `${currentYear}-${Date.now().toString().slice(-6)}`; 
  }
  
  return newId;
};
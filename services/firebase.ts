import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

// ------------------------------------------------------------------
// CONFIGURATION
// We use a safe check for 'import.meta.env' to prevent crashes.
// If env vars are missing, we fallback to the provided hardcoded values.
// ------------------------------------------------------------------

// Safe access to environment variables
const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyAIgzM-eqJFxuPN3mBOh1XLnWxlUKxCcA4",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "retriva-700f9.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "retriva-700f9",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "retriva-700f9.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "654844686844",
  appId: env.VITE_FIREBASE_APP_ID || "1:654844686844:web:0a07f0a02a84cfa4c04279",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-1VS8EVKFVK"
};

// Log warning only if hardcoded fallback is also missing (unlikely given code above)
if (!firebaseConfig.apiKey) {
  console.error("RETRIVA CRITICAL ERROR: Firebase API Key is missing.");
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
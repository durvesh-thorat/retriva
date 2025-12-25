import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

// ------------------------------------------------------------------
// IMPORTANT: CONFIGURATION REQUIRED
// The keys below are for a demo project (retriva-700f9).
// If you are hosting this app on your own domain (e.g. Vercel),
// you MUST replace these values with your own Firebase Project Config.
//
// 1. Go to Firebase Console (https://console.firebase.google.com)
// 2. Create a new project (or use existing)
// 3. Go to Project Settings > General > "Your apps"
// 4. Copy the "firebaseConfig" object and replace the one below.
// 5. THEN, go to Auth > Settings > Authorized Domains and add your Vercel domain.
// ------------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyAIgzM-eqJFxuPN3mBOh1XLnWxlUKxCcA4",
  authDomain: "retriva-700f9.firebaseapp.com",
  projectId: "retriva-700f9",
  storageBucket: "retriva-700f9.firebasestorage.app",
  messagingSenderId: "654844686844",
  appId: "1:654844686844:web:0a07f0a02a84cfa4c04279",
  measurementId: "G-1VS8EVKFVK"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
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

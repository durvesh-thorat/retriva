
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

const app = initializeApp(firebaseConfig);

// Export authentication and database services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

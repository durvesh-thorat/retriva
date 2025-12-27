import { compressImage } from './imageCompression';

// VERCEL CONFIG: Add these to Environment Variables in Vercel Dashboard
// Direct access ensures Vite replaces them at build time.
const CLOUD_NAME = (import.meta as any).env.VITE_CLOUDINARY_CLOUD_NAME || "dcvdiiwwm";
const UPLOAD_PRESET = (import.meta as any).env.VITE_CLOUDINARY_UPLOAD_PRESET || "retriva_unsigned";

export const uploadImage = async (file: File): Promise<string> => {
  if (!file) throw new Error("No file selected");

  // 1. Attempt Cloudinary Upload
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Cloudinary upload failed');
    }

    const data = await response.json();
    return data.secure_url; // Success: Return the HTTPS URL
  } catch (error) {
    console.warn("Cloudinary upload failed. activating local fallback...", error);

    // 2. Fallback: Local Compression (Base64)
    // If Cloudinary fails (e.g. missing Vercel env vars), we convert to Base64 
    // and compress it so it fits in Firestore.
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Compress using your existing service (Resizes to ~600px width)
      const compressedBase64 = await compressImage(base64);
      return compressedBase64; 
    } catch (fallbackError) {
      console.error("Critical: Both Cloudinary and Fallback failed.", fallbackError);
      throw new Error("Image upload failed completely.");
    }
  }
};
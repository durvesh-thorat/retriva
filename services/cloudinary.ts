
const CLOUD_NAME = "dcvdiiwwm";
const UPLOAD_PRESET = "retriva_unsigned";

export const uploadImage = async (file: File): Promise<string> => {
  if (!file) throw new Error("No file selected");

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Upload failed');
    }

    const data = await response.json();
    return data.secure_url; // Returns the https link
  } catch (error) {
    console.error("Cloudinary Upload Error:", error);
    throw error;
  }
};

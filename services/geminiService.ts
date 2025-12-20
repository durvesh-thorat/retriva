
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";

// Moved initialization inside functions to prevent white-screen on load if env vars are missing
const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    // This specific error message is caught by the ErrorBoundary in index.tsx
    throw new Error("API Key must be set. Please check Vercel Environment Variables.");
  }
  return new GoogleGenAI({ apiKey });
};

// Model Cascade List: Primary -> Fallbacks
// 1. Gemini 3 Flash (Fastest, Newest)
// 2. Gemini 2.5 Flash (Reliable, Previous Gen)
// 3. Gemini Flash Lite (Lightweight, High QPS)
// 4. Gemini 3 Pro (High Intelligence, Different Quota Bucket)
const MODEL_CASCADE = [
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3-pro-preview'
];

/**
 * Wrapper for generateContent that implements Model Cascading.
 * If the primary model fails due to Rate Limiting (429) or Overload (503),
 * it automatically retries with the next model in the list.
 */
const generateWithCascade = async (
  params: any
): Promise<GenerateContentResponse> => {
  let lastError: any;
  // Initialize AI client lazily
  let ai;
  try {
    ai = getAI();
  } catch (e) {
    console.error("Gemini Client Init Failed:", e);
    throw e;
  }

  for (const modelName of MODEL_CASCADE) {
    try {
      // console.log(`Attempting generation with model: ${modelName}`);
      const response = await ai.models.generateContent({
        ...params,
        model: modelName,
      });
      return response;
    } catch (error: any) {
      const isRateLimit = error.message?.includes('429') || error.message?.includes('Too Many Requests') || error.status === 429;
      const isQuota = error.message?.includes('quota') || error.message?.includes('exhausted');
      const isOverloaded = error.message?.includes('503') || error.status === 503;
      const isModelNotFound = error.message?.includes('404') || error.message?.includes('not found');

      // Only cascade on transient/quota errors
      if (isRateLimit || isQuota || isOverloaded || isModelNotFound) {
        console.warn(`Model ${modelName} failed (${error.status || 'Unknown'}). Switching to next available model.`);
        lastError = error;
        continue; // Try next model
      }
      
      // If it's a structural error (400 Bad Request), fail immediately
      throw error;
    }
  }
  
  console.error("All models in cascade failed. Last error:", lastError);
  throw lastError || new Error("Model cascade exhausted.");
};

/**
 * Instantly checks a single image for unwanted content (Gore, Humans, Animals).
 */
export const instantImageCheck = async (base64Image: string): Promise<{ 
  faceStatus: 'NONE' | 'ACCIDENTAL' | 'PRANK';
  isPrank: boolean;
  violationType: 'GORE' | 'ANIMAL' | 'HUMAN' | 'NONE';
  reason: string;
}> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    
    const response = await generateWithCascade({
      contents: {
        parts: [
          { text: `
            STRICT SECURITY SCAN. Analyze this image for a Campus Lost & Found App.
            Identify if the image contains any of the following PROHIBITED content:
            1. GORE/VIOLENCE: Blood, injury, weapons, disturbing content.
            2. HUMAN FOCUS: Selfies, portraits, whole human bodies (incidental background crowds are OK, but main subject cannot be a person).
            3. ANIMALS: Pets, wild animals (This app is for OBJECTS only, not lost pets).
            4. NUDITY/INAPPROPRIATE: Any NSFW content.
            
            Return JSON with:
            - violationType: 'GORE', 'ANIMAL', 'HUMAN', or 'NONE'.
            - isPrank: true if any violation is found.
            - reason: Short explanation (e.g. "Image contains a cat").
            - faceStatus: 'PRANK' (if selfie), 'ACCIDENTAL' (if background), 'NONE'.
          ` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            faceStatus: { type: Type.STRING, enum: ['NONE', 'ACCIDENTAL', 'PRANK'] },
            violationType: { type: Type.STRING, enum: ['GORE', 'ANIMAL', 'HUMAN', 'NONE'] },
            isPrank: { type: Type.BOOLEAN },
            reason: { type: Type.STRING }
          },
          required: ["faceStatus", "isPrank", "violationType", "reason"]
        }
      }
    });

    return response.text ? JSON.parse(response.text) : { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "" };
  } catch (e) {
    console.error("Instant check failed", e);
    // Return safe default so app doesn't crash on one failed check
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

/**
 * Full report verification and content enhancement.
 * Includes Consistency and Relevance checks.
 */
export const analyzeItemDescription = async (
  description: string,
  base64Images: string[] = [],
  title: string = ""
): Promise<GeminiAnalysisResult> => {
  try {
    const promptText = `
      Task: INTELLIGENT CONTENT MODERATION & ANALYSIS.
      
      INPUT DATA:
      - Title: "${title}"
      - Description: "${description}"
      - Images Attached: ${base64Images.length}
      
      SECURITY OBJECTIVES (PRIORITY 1):
      1. RELEVANCE CHECK: Is the user describing a physical, tangible object? 
         - Reject abstract concepts like "Lost Love", "Lost Hope", "Lost Dignity", "My Soul".
         - Reject non-lost-and-found content (rants, advertisements, jokes).
      2. CONSISTENCY CHECK: Does the Title match the Description?
         - Reject if Title says "Smartphone" but Description describes "Lenovo Laptop".
         - Reject if Title says "Water Bottle" but Image clearly shows a "Shoe" (if images provided).
      3. PROHIBITED CONTENT: Check for gore, animals, humans mentioned as the item.
      
      ANALYSIS OBJECTIVES (PRIORITY 2 - Only if Security Passes):
      1. VISUAL EXTRACTION: Analyze images for details (Brand, Color, Scratches).
      2. MERGE: Combine User Text + Image Truth into a professional description.
      3. DISTINGUISHING MARKS: Extract 3-5 unique features.
      
      OUTPUT JSON RULES:
      - If violating relevance/consistency: Set isViolating=true, violationType='IRRELEVANT' or 'INCONSISTENT'.
      - violationReason: Explain strictly why (e.g. "Title 'iPhone' contradicts description 'Adidas Shoes'").
    `;

    const parts: any[] = [{ text: promptText }];
    base64Images.forEach(img => {
      const data = img.split(',')[1] || img;
      if (data) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data } });
      }
    });

    const response = await generateWithCascade({
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isViolating: { type: Type.BOOLEAN },
            violationType: { type: Type.STRING, enum: ['GORE', 'ANIMAL', 'HUMAN', 'IRRELEVANT', 'INCONSISTENT', 'NONE'] },
            violationReason: { type: Type.STRING },
            isPrank: { type: Type.BOOLEAN },
            prankReason: { type: Type.STRING },
            isEmergency: { type: Type.BOOLEAN },
            faceStatus: { type: Type.STRING, enum: ['NONE', 'ACCIDENTAL', 'PRANK'] },
            category: { type: Type.STRING, enum: Object.values(ItemCategory) },
            title: { type: Type.STRING },
            description: { type: Type.STRING, description: "The merged, polished description." },
            distinguishingFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["isViolating", "violationType", "violationReason", "isPrank", "category", "title", "description", "distinguishingFeatures", "summary", "tags"]
        }
      }
    });

    return response.text ? JSON.parse(response.text) : { 
      isViolating: false,
      isPrank: false, 
      faceStatus: 'NONE', 
      category: ItemCategory.OTHER, 
      title: title || "Item", 
      description, 
      distinguishingFeatures: [],
      summary: "", 
      tags: [] 
    };
  } catch (error) {
    console.error("AI Analysis Error", error);
    // Throw if it's an API key error so the boundary catches it, otherwise fail gracefully
    if (error instanceof Error && error.message.includes('API Key')) throw error;
    
    return { 
      isViolating: false,
      isPrank: false, 
      isEmergency: false, 
      faceStatus: 'NONE', 
      category: ItemCategory.OTHER, 
      title: title || "Item", 
      description, 
      distinguishingFeatures: [],
      summary: "", 
      tags: [] 
    };
  }
};

export const parseSearchQuery = async (query: string): Promise<{ userStatus: 'LOST' | 'FOUND' | 'NONE'; refinedQuery: string }> => {
  try {
    const response = await generateWithCascade({
      contents: {
        parts: [{ text: `Determine intent (LOST/FOUND/NONE) for: "${query}". Return JSON.` }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            userStatus: { type: Type.STRING, enum: ['LOST', 'FOUND', 'NONE'] },
            refinedQuery: { type: Type.STRING }
          },
          required: ["userStatus", "refinedQuery"]
        }
      }
    });
    return response.text ? JSON.parse(response.text) : { userStatus: 'NONE', refinedQuery: query };
  } catch (e) {
    return { userStatus: 'NONE', refinedQuery: query };
  }
};

export const findPotentialMatches = async (
  query: { description: string; imageUrls: string[] },
  candidates: ItemReport[]
): Promise<{ id: string }[]> => {
  if (candidates.length === 0) return [];
  try {
    const candidateList = candidates.map(c => ({ 
        id: c.id, 
        title: c.title, 
        description: c.description,
        category: c.category,
        location: c.location,
        date: c.date
    }));
    
    const parts: any[] = [{ text: `
      Task: Find matches for the Lost/Found item.
      Source Item Description: ${query.description}
      
      Candidate Database: ${JSON.stringify(candidateList)}
      
      Return a JSON object with a "matches" array containing objects with the "id" of candidates that are plausible matches based on category, visual description, location proximity, and date logic.
    ` }];

    // Only attach valid base64 images to avoid 400 errors with HTTP URLs
    query.imageUrls.forEach(img => {
      if (img.startsWith('data:')) {
        const data = img.split(',')[1];
        if (data) {
           parts.push({ inlineData: { mimeType: "image/jpeg", data } });
        }
      }
    });

    const response = await generateWithCascade({
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matches: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] } }
          },
          required: ["matches"]
        }
      }
    });
    const data = response.text ? JSON.parse(response.text) : { matches: [] };
    return data.matches;
  } catch (e) {
    console.error("Match finding error", e);
    return [];
  }
};

export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

export const compareItems = async (itemA: ItemReport, itemB: ItemReport): Promise<ComparisonResult> => {
  try {
    // Construct rich text context for detailed reasoning
    const contextA = `
      Item A (${itemA.type}):
      - Title: ${itemA.title}
      - Category: ${itemA.category}
      - Description: ${itemA.description}
      - Location: ${itemA.location}
      - Date: ${itemA.date} at ${itemA.time}
      - Features: ${itemA.distinguishingFeatures?.join(', ') || 'None'}
      - Tags: ${itemA.tags.join(', ')}
    `;

    const contextB = `
      Item B (${itemB.type}):
      - Title: ${itemB.title}
      - Category: ${itemB.category}
      - Description: ${itemB.description}
      - Location: ${itemB.location}
      - Date: ${itemB.date} at ${itemB.time}
      - Features: ${itemB.distinguishingFeatures?.join(', ') || 'None'}
      - Tags: ${itemB.tags.join(', ')}
    `;

    const promptText = `
      Act as an expert investigator for a Campus Lost & Found.
      Compare Item A and Item B to determine if they are the same physical object.

      DATA:
      ${contextA}
      ${contextB}

      ANALYSIS RULES:
      1. Visuals: Do the descriptions and features match? (Color, brand, unique marks like stickers/dents).
      2. Location: Is the found location consistent with the lost location? (e.g. Lost in Library, Found in Library OR nearby/cleaning desk).
      3. Time: Was the item found AFTER it was lost? (Found date/time >= Lost date/time). If Found date is BEFORE Lost date, it's virtually impossible (0% match) unless dates are stated as approximate.
      4. Logic: Use common sense. A "Phone" cannot be a "Water Bottle".

      OUTPUT:
      - confidence: 0-100.
      - explanation: Concise summary (2 sentences).
      - similarities: Array of strings highlighting matching features (e.g. "Both are silver MacBooks", "Matching NASA sticker").
      - differences: Array of strings highlighting discrepancies (e.g. "Item A has a dent, Item B is pristine", "Locations are 5 miles apart").
    `;

    const parts: any[] = [{ text: promptText }];

    // Add images if they are base64 data URLs
    const imagesToAdd = [itemA.imageUrls[0], itemB.imageUrls[0]].filter(url => url && url.startsWith('data:'));
    
    imagesToAdd.forEach(img => {
      const data = img.split(',')[1];
      if (data) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data } });
      }
    });

    const response = await generateWithCascade({
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            confidence: { type: Type.NUMBER },
            explanation: { type: Type.STRING },
            similarities: { type: Type.ARRAY, items: { type: Type.STRING } },
            differences: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["confidence", "explanation", "similarities", "differences"]
        }
      }
    });

    return response.text ? JSON.parse(response.text) : { confidence: 0, explanation: "Analysis could not be generated.", similarities: [], differences: [] };
  } catch (e) {
    console.error("Comparison Error", e);
    return { confidence: 0, explanation: "Comparison failed due to technical error.", similarities: [], differences: [] };
  }
};
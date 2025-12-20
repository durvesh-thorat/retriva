
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
const MODEL_CASCADE = [
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3-pro-preview'
];

/**
 * Helper to strip Markdown code blocks (```json ... ```) from AI response
 */
const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  // Remove markdown code blocks
  let cleaned = text.replace(/```json\s*|\s*```/g, "");
  // Remove generic code blocks if json tag missing
  cleaned = cleaned.replace(/```\s*|\s*```/g, "");
  return cleaned.trim();
};

/**
 * Wrapper for generateContent that implements Model Cascading.
 */
const generateWithCascade = async (
  params: any
): Promise<GenerateContentResponse> => {
  let lastError: any;
  let ai;
  try {
    ai = getAI();
  } catch (e) {
    console.error("Gemini Client Init Failed:", e);
    throw e;
  }

  for (const modelName of MODEL_CASCADE) {
    try {
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

      if (isRateLimit || isQuota || isOverloaded || isModelNotFound) {
        console.warn(`Model ${modelName} failed. Switching to next.`);
        lastError = error;
        continue; 
      }
      throw error;
    }
  }
  console.error("All models in cascade failed.");
  throw lastError || new Error("Model cascade exhausted.");
};

/**
 * Instantly checks a single image for unwanted content.
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
            Identify if the image contains PROHIBITED content (Gore, Pets, Selfies).
            Return JSON.
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

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e) {
    console.error("Instant check failed", e);
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

/**
 * Full report verification and content enhancement.
 */
export const analyzeItemDescription = async (
  description: string,
  base64Images: string[] = [],
  title: string = ""
): Promise<GeminiAnalysisResult> => {
  try {
    const promptText = `
      Task: INTELLIGENT CONTENT MODERATION & ANALYSIS for Lost & Found.
      Title: "${title}"
      Description: "${description}"
      
      Output JSON with cleaned fields. If violations (gore/spam/irrelevant), set isViolating=true.
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
            description: { type: Type.STRING },
            distinguishingFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["isViolating", "category", "title", "description", "tags"]
        }
      }
    });

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("AI Analysis Error", error);
    // Return fail-safe object
    return { 
      isViolating: false,
      isPrank: false, 
      category: ItemCategory.OTHER, 
      title: title || "Item", 
      description, 
      distinguishingFeatures: [],
      summary: "", 
      tags: [],
      faceStatus: 'NONE'
    } as any;
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
    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
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
        desc: c.description,
        cat: c.category
    }));
    
    const parts: any[] = [{ text: `
      Task: Find matches.
      Source: ${query.description}
      Candidates: ${JSON.stringify(candidateList)}
      Return JSON { "matches": [{ "id": "..." }] }
    ` }];

    // Attach first image only to save bandwidth
    if (query.imageUrls.length > 0 && query.imageUrls[0].startsWith('data:')) {
       const data = query.imageUrls[0].split(',')[1];
       parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }

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
    const text = response.text ? cleanJSON(response.text) : "{}";
    const data = JSON.parse(text);
    return data.matches || [];
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
    const promptText = `
      Compare Item A (${itemA.title}) and Item B (${itemB.title}).
      Are they the same object?
      Return JSON: { confidence: number, explanation: string, similarities: string[], differences: string[] }
    `;

    const parts: any[] = [{ text: promptText }];
    const imagesToAdd = [itemA.imageUrls[0], itemB.imageUrls[0]].filter(url => url && url.startsWith('data:'));
    imagesToAdd.forEach(img => {
      const data = img.split(',')[1];
      if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
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

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e) {
    console.error("Comparison Error", e);
    return { confidence: 0, explanation: "Comparison failed.", similarities: [], differences: [] };
  }
};

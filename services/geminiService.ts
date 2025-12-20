
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";

// Helper to safely get the API Key from various environment configurations (Vite, Next.js, Webpack)
const getApiKey = (): string | undefined => {
  // 1. Try process.env (Standard/Webpack/Next.js)
  try {
    if (typeof process !== 'undefined' && process.env?.API_KEY) return process.env.API_KEY;
  } catch (e) {}

  // 2. Try import.meta.env (Vite)
  try {
    // @ts-ignore - Handle Vite types without explicit config
    const metaEnv = import.meta?.env;
    if (metaEnv) {
      if (metaEnv.VITE_API_KEY) return metaEnv.VITE_API_KEY;
      if (metaEnv.API_KEY) return metaEnv.API_KEY;
    }
  } catch (e) {}

  return undefined;
};

const getAI = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
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
 * Robust JSON Cleaner: Extracts the first valid JSON object from a string.
 */
const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  
  // 1. Remove Markdown code blocks
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  
  // 2. Find the first '{' and the last '}'
  const firstOpen = cleaned.indexOf('{');
  const lastClose = cleaned.lastIndexOf('}');
  
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    cleaned = cleaned.substring(firstOpen, lastClose + 1);
  } else {
    // If no brackets found, return empty object to prevent crash
    return "{}";
  }

  return cleaned.trim();
};

const generateWithCascade = async (
  params: any
): Promise<GenerateContentResponse> => {
  let lastError: any;
  let ai;
  try {
    ai = getAI();
  } catch (e: any) {
    if (e.message === 'MISSING_API_KEY') {
       // Re-throw specifically so callers can handle it gracefully
       throw new Error("MISSING_API_KEY");
    }
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
      console.warn(`Model ${modelName} failed.`, error.message);
      lastError = error;
      continue; 
    }
  }
  console.error("All models in cascade failed.");
  throw lastError || new Error("Model cascade exhausted.");
};

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
            SYSTEM: Security Scan.
            Analyze image for specific violations:
            1. GORE/VIOLENCE
            2. NUDITY
            3. SELFIE/FACES (Privacy risk)
            
            Return strictly JSON:
            {
              "faceStatus": "NONE" | "ACCIDENTAL" | "PRANK",
              "violationType": "GORE" | "ANIMAL" | "HUMAN" | "NONE",
              "isPrank": boolean,
              "reason": "string"
            }
          ` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e: any) {
    if (e.message === "MISSING_API_KEY") {
      console.warn("AI Security Scan Skipped: API Key missing.");
    } else {
      console.error("Instant check failed", e);
    }
    // Fail safe: assume safe if AI fails, let manual review catch it
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const analyzeItemDescription = async (
  description: string,
  base64Images: string[] = [],
  title: string = ""
): Promise<GeminiAnalysisResult> => {
  try {
    const promptText = `
      Task: Enhance description and validate content.
      Title: "${title}"
      Raw Input: "${description}"
      
      Instructions:
      1. Correct grammar and clarity.
      2. Extract Item Category (Electronics, Clothing, etc).
      3. Identify potential Policy Violations (Drugs, Weapons, Spam).
      
      Return strictly JSON matching this schema:
      {
        "isViolating": boolean,
        "violationType": "GORE" | "ANIMAL" | "HUMAN" | "IRRELEVANT" | "INCONSISTENT" | "NONE",
        "violationReason": "string",
        "category": "string",
        "title": "refined title",
        "description": "enhanced description",
        "summary": "short summary",
        "tags": ["tag1", "tag2"],
        "distinguishingFeatures": ["feature1", "feature2"]
      }
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
        responseMimeType: "application/json"
      }
    });

    const text = response.text ? cleanJSON(response.text) : "{}";
    const result = JSON.parse(text);

    // Fallbacks if AI misses fields
    return {
      isViolating: result.isViolating || false,
      violationType: result.violationType || 'NONE',
      violationReason: result.violationReason || '',
      isPrank: false,
      category: result.category || ItemCategory.OTHER,
      title: result.title || title,
      description: result.description || description,
      summary: result.summary || description.substring(0, 50),
      tags: result.tags || [],
      distinguishingFeatures: result.distinguishingFeatures || [],
      faceStatus: 'NONE'
    };
  } catch (error: any) {
    if (error.message === "MISSING_API_KEY") {
        console.warn("AI Analysis Skipped: API Key missing.");
    } else {
        console.error("AI Analysis Error", error);
    }
    // Return original data on error so user isn't blocked
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
        parts: [{ text: `Determine intent (LOST/FOUND/NONE) and extract keywords for: "${query}". Return JSON: { "userStatus": "LOST"|"FOUND"|"NONE", "refinedQuery": "keywords" }` }]
      },
      config: { responseMimeType: "application/json" }
    });
    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e: any) {
    if (e.message !== "MISSING_API_KEY") console.error(e);
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
      Task: Find items in Candidates that match Source.
      Source: ${query.description}
      Candidates: ${JSON.stringify(candidateList)}
      Return JSON: { "matches": [{ "id": "candidate_id" }] }
    ` }];

    if (query.imageUrls.length > 0 && query.imageUrls[0].startsWith('data:')) {
       const data = query.imageUrls[0].split(',')[1];
       parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }

    const response = await generateWithCascade({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    });
    const text = response.text ? cleanJSON(response.text) : "{}";
    const data = JSON.parse(text);
    return data.matches || [];
  } catch (e: any) {
    if (e.message !== "MISSING_API_KEY") console.error("Match finding error", e);
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
      Return JSON: { "confidence": number (0-100), "explanation": "string", "similarities": ["s1"], "differences": ["d1"] }
    `;

    const parts: any[] = [{ text: promptText }];
    const imagesToAdd = [itemA.imageUrls[0], itemB.imageUrls[0]].filter(url => url && url.startsWith('data:'));
    imagesToAdd.forEach(img => {
      const data = img.split(',')[1];
      if (data) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    });

    const response = await generateWithCascade({
      contents: { parts },
      config: { responseMimeType: "application/json" }
    });

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e: any) {
    if (e.message !== "MISSING_API_KEY") console.error("Comparison Error", e);
    return { confidence: 0, explanation: "Comparison failed.", similarities: [], differences: [] };
  }
};
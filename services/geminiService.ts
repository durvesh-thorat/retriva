import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";

export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

// Helper: Sleep function for backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- CIRCUIT BREAKER CONFIGURATION ---
const BLOCK_DURATION = 6 * 60 * 60 * 1000; // 6 Hours
const STORAGE_KEY_BLOCK = 'retriva_circuit_breaker_until';
const STORAGE_KEY_HASH = 'retriva_api_key_hash';

// Helper to safely get the API Key with priority for VITE_ prefix
const getApiKey = (provider: 'GOOGLE' | 'GROQ'): string | undefined => {
  let key: string | undefined = undefined;
  const targetKey = provider === 'GOOGLE' ? 'API_KEY' : 'GROQ_API_KEY';
  const viteKey = `VITE_${targetKey}`;

  // 1. Try Vite standard (import.meta.env)
  try {
    // @ts-ignore
    if (import.meta.env) {
      // @ts-ignore
      key = import.meta.env[viteKey] || import.meta.env[targetKey];
    }
  } catch (e) {}

  // 2. Try process.env (Node/Webpack/Vercel Polyfills)
  if (!key) {
    try {
      if (typeof process !== 'undefined' && process.env) {
        key = process.env[viteKey] || process.env[targetKey];
      }
    } catch (e) {}
  }

  return key;
};

// --- CIRCUIT BREAKER LOGIC ---

const getApiKeyHash = (key: string) => {
  if (!key) return 'unknown';
  // Use last 6 chars as a signature to detect change without exposing key
  return key.slice(-6);
};

const checkCircuitBreaker = (): boolean => {
  const apiKey = getApiKey('GOOGLE');
  if (!apiKey) return false;

  const currentHash = getApiKeyHash(apiKey);
  const storedHash = localStorage.getItem(STORAGE_KEY_HASH);
  const blockUntil = localStorage.getItem(STORAGE_KEY_BLOCK);

  // 1. Check for API Key Rotation (Admin updated env var)
  // If the key in the code doesn't match the one we blocked, reset everything.
  if (storedHash && storedHash !== currentHash) {
    console.info("⚡ API Key Rotation Detected. Resetting AI Circuit Breaker.");
    localStorage.removeItem(STORAGE_KEY_BLOCK);
    localStorage.setItem(STORAGE_KEY_HASH, currentHash);
    return false;
  }

  // 2. Check if Block is Active
  if (blockUntil) {
    const liftTime = parseInt(blockUntil, 10);
    if (Date.now() < liftTime) {
       console.warn(`🛡️ Circuit Breaker Active. Gemini blocked until ${new Date(liftTime).toLocaleTimeString()}. Using Groq.`);
       return true;
    } else {
       // Block expired
       localStorage.removeItem(STORAGE_KEY_BLOCK);
       return false;
    }
  }

  return false;
};

const tripCircuitBreaker = () => {
    const apiKey = getApiKey('GOOGLE');
    if (apiKey) {
        localStorage.setItem(STORAGE_KEY_HASH, getApiKeyHash(apiKey));
    }
    const liftTime = Date.now() + BLOCK_DURATION;
    localStorage.setItem(STORAGE_KEY_BLOCK, liftTime.toString());
    
    console.error(`⛔ Gemini Circuit Breaker Tripped. All requests switched to Groq for 6 hours.`);
    
    // Dispatch event for UI toast (App.tsx listens for this)
    if (typeof window !== 'undefined') {
        const event = new CustomEvent('retriva-toast', { 
            detail: { 
                message: "Gemini overloaded. Switched to Backup AI for 6h.", 
                type: 'alert' 
            } 
        });
        window.dispatchEvent(event);
    }
};

const getAI = () => {
  const apiKey = getApiKey('GOOGLE');
  if (!apiKey) {
    console.error("DEBUG: Google API Key missing.");
    throw new Error("MISSING_GOOGLE_KEY");
  }
  return new GoogleGenAI({ apiKey });
};

// Model Cascade List: Fastest -> Most Capable
const GOOGLE_CASCADE = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

// Fallback Model (Groq)
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'; 

const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  const firstOpen = cleaned.indexOf('{');
  const lastClose = cleaned.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    cleaned = cleaned.substring(firstOpen, lastClose + 1);
  } else {
    return "{}";
  }
  return cleaned.trim();
};

const convertGeminiToGroq = (contents: any) => {
  const parts = contents.parts || [];
  let fullText = "";

  parts.forEach((part: any) => {
    if (part.text) {
      fullText += part.text + "\n";
    } else if (part.inlineData) {
      fullText += "\n[System Note: The user uploaded an image. Please infer details from the user's text description if available, or ask for a text description as direct image processing is currently bridged to text-only fallback.]\n";
    }
  });

  return [{ role: "user", content: fullText.trim() }];
};

const callGroqAPI = async (messages: any[], jsonMode: boolean = false) => {
  const apiKey = getApiKey('GROQ');
  if (!apiKey) throw new Error("Missing Groq API Key");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages,
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      response_format: jsonMode ? { type: "json_object" } : { type: "text" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API Error ${response.status}: ${errText}`);
  }

  return await response.json();
};

// Extracted Groq Fallback Logic
const runGroqFallback = async (params: any): Promise<{ text: string }> => {
  console.warn("Attempting Groq fallback...");
  if (getApiKey('GROQ')) {
    try {
      const messages = convertGeminiToGroq(params.contents);
      const isJson = params.config?.responseMimeType === 'application/json';
      
      const completion = await callGroqAPI(messages, isJson);

      console.info("Fallback Success: Groq generated response.");
      const text = completion.choices[0]?.message?.content || "";
      return { text };

    } catch (groqError: any) {
      console.error("Groq Fallback failed:", groqError);
      throw new Error("Both Gemini and Groq failed.");
    }
  } else {
    console.warn("Skipping Groq: No VITE_GROQ_API_KEY found.");
    throw new Error("AI Service Unavailable (No Backup Key).");
  }
};

const generateWithCascade = async (
  params: any
): Promise<{ text: string }> => {
  
  // 1. CIRCUIT BREAKER CHECK
  if (checkCircuitBreaker()) {
      return await runGroqFallback(params);
  }

  let lastError: any;
  
  // 2. TRY GOOGLE GEMINI MODELS (PRIMARY)
  try {
    const ai = getAI();
    
    // Iterate through models. If one fails, IMMEDIATELY switch to the next.
    for (const modelName of GOOGLE_CASCADE) {
        try {
          const response = await ai.models.generateContent({
            ...params,
            model: modelName,
          });
          
          return { text: response.text || "" };

        } catch (error: any) {
          console.warn(`Gemini ${modelName} failed/rate-limited. Switching to next model immediately.`);
          lastError = error;
          continue; 
        }
    }
  } catch (e: any) {
    if (e.message === 'MISSING_GOOGLE_KEY') lastError = e;
  }

  // 3. FALLBACK & TRIP BREAKER
  // If we reached here, ALL Gemini models failed.
  console.error("All Gemini models exhausted.");
  
  // Only trip the breaker if it wasn't a missing key error (which is a config issue, not a rate limit)
  if (lastError?.message !== 'MISSING_GOOGLE_KEY') {
      tripCircuitBreaker();
  }

  return await runGroqFallback(params);
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
    if (e.message === "MISSING_GOOGLE_KEY") {
      console.warn("AI Security Scan Skipped: API Key missing.");
    } else {
      console.error("Instant check failed", e);
    }
    return { faceStatus: 'NONE', violationType: 'NONE', isPrank: false, reason: "Check unavailable" };
  }
};

export const detectRedactionRegions = async (base64Image: string): Promise<number[][]> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const response = await generateWithCascade({
      contents: {
        parts: [
          { text: `
            Analyze this image for privacy protection.
            Identify bounding boxes for:
            1. Human Faces
            2. Identity Documents (Driver Licenses, Student IDs, Passports)
            3. Credit/Debit Cards
            4. Papers containing visible PII (names, phone numbers, addresses)

            Return strictly JSON:
            {
              "regions": [
                 [ymin, xmin, ymax, xmax], // 0 to 1000 scale integers
                 ...
              ]
            }
            If no sensitive content, return { "regions": [] }.
            Use 1000 as the scale (e.g. 500 = 50%).
          ` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });

    const text = response.text ? cleanJSON(response.text) : "{}";
    const data = JSON.parse(text);
    return data.regions || [];
  } catch (e) {
    console.error("Redaction check failed", e);
    return [];
  }
};

export const extractVisualDetails = async (base64Image: string): Promise<{
  title: string;
  category: ItemCategory;
  tags: string[];
  color: string;
  brand: string;
  condition: string;
  distinguishingFeatures: string[];
}> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const response = await generateWithCascade({
      contents: {
        parts: [
          { text: `
            Analyze this image for a Lost & Found report.
            Extract factual visual details.
            
            Return JSON:
            {
              "title": "Concise Item Name (e.g. Silver Dell XPS 13)",
              "category": "One of: Electronics, Stationery, Clothing, Accessories, ID Cards, Books, Other",
              "tags": ["tag1", "tag2", "tag3"],
              "color": "Primary Color",
              "brand": "Brand Name or Unknown",
              "condition": "Visual condition (e.g. Scratched, New, Worn)",
              "distinguishingFeatures": ["feature1", "feature2"]
            }
          `},
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { responseMimeType: "application/json" }
    });
    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e) {
    console.error("Autofill failed", e);
    return { 
      title: "", category: ItemCategory.OTHER, tags: [], 
      color: "", brand: "", condition: "", distinguishingFeatures: [] 
    };
  }
};

export const mergeDescriptions = async (
  userContext: string, 
  visualData: any
): Promise<string> => {
  try {
    const response = await generateWithCascade({
      contents: {
        parts: [{ text: `
          Task: Create a comprehensive "3D Description" for a lost item.
          
          Input 1 (Visual Facts from AI): ${JSON.stringify(visualData)}
          Input 2 (User Context): "${userContext}"
          
          Instructions:
          - Combine the specific visual details (scratches, brand, color) with the user's story (where lost, when).
          - Write in natural, helpful language for a lost & found post.
          - Keep it under 300 characters but very descriptive.
          - Do NOT repeat "AI detected". Just describe the item.
        `}]
      }
    });
    return response.text || userContext;
  } catch (e) {
    return userContext;
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
    if (error.message === "MISSING_GOOGLE_KEY") {
        console.warn("AI Analysis Skipped: API Key missing.");
    } else {
        console.error("AI Analysis Error", error);
    }
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
    if (e.message !== "MISSING_GOOGLE_KEY") console.error(e);
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
    if (e.message !== "MISSING_GOOGLE_KEY") console.error("Match finding error", e);
    return [];
  }
};

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
    if (e.message !== "MISSING_GOOGLE_KEY") console.error("Comparison Error", e);
    return { confidence: 0, explanation: "Comparison failed.", similarities: [], differences: [] };
  }
};

import { GoogleGenAI, Type } from "@google/genai";
import { ItemCategory, GeminiAnalysisResult, ItemReport } from "../types";

export interface ComparisonResult {
  confidence: number;
  explanation: string;
  similarities: string[];
  differences: string[];
}

// --- CIRCUIT BREAKER CONFIGURATION ---
const BLOCK_DURATION = 6 * 60 * 60 * 1000; // 6 Hours
const STORAGE_KEY_BLOCK = 'retriva_circuit_breaker_until';
const STORAGE_KEY_HASH = 'retriva_api_key_hash';

// Helper to safely get the API Key with priority for VITE_ prefix
const getApiKey = (provider: 'GOOGLE' | 'GROQ'): string | undefined => {
  let key: string | undefined = undefined;
  const targetKey = provider === 'GOOGLE' ? 'API_KEY' : 'GROQ_API_KEY';
  const viteKey = `VITE_${targetKey}`;

  try {
    // @ts-ignore
    if (import.meta.env) {
      // @ts-ignore
      key = import.meta.env[viteKey] || import.meta.env[targetKey];
    }
  } catch (e) {}

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
  return key.slice(-6);
};

const checkCircuitBreaker = (): boolean => {
  const apiKey = getApiKey('GOOGLE');
  if (!apiKey) return false;

  const currentHash = getApiKeyHash(apiKey);
  const storedHash = localStorage.getItem(STORAGE_KEY_HASH);
  const blockUntil = localStorage.getItem(STORAGE_KEY_BLOCK);

  if (storedHash && storedHash !== currentHash) {
    console.info("⚡ API Key Rotation Detected. Resetting AI Circuit Breaker.");
    localStorage.removeItem(STORAGE_KEY_BLOCK);
    localStorage.setItem(STORAGE_KEY_HASH, currentHash);
    return false;
  }

  if (blockUntil) {
    const liftTime = parseInt(blockUntil, 10);
    if (Date.now() < liftTime) {
       console.warn(`🛡️ Circuit Breaker Active. Gemini blocked until ${new Date(liftTime).toLocaleTimeString()}. Using Groq.`);
       return true;
    } else {
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

// Model Cascade List: Prioritize Reasoning Models
const GOOGLE_CASCADE = [
  'gemini-3-pro-preview',    // Best for Logic/Reasoning
  'gemini-3-flash-preview',  // Best for Speed/Vision
];

// Fallback Model (Groq)
const GROQ_MODEL = 'llama-3.3-70b-versatile'; 

const cleanJSON = (text: string): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  const firstOpen = cleaned.indexOf('{');
  const lastClose = cleaned.lastIndexOf('}');
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    cleaned = cleaned.substring(firstOpen, lastClose + 1);
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
      fullText += "\n[System Note: The user uploaded an image. Please infer details from the user's text description if available.]\n";
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

const runGroqFallback = async (params: any): Promise<{ text: string }> => {
  console.warn("Attempting Groq fallback...");
  if (getApiKey('GROQ')) {
    try {
      const messages = convertGeminiToGroq(params.contents);
      const isJson = !!params.config?.responseSchema || params.config?.responseMimeType === 'application/json';
      
      const completion = await callGroqAPI(messages, isJson);
      const text = completion.choices[0]?.message?.content || "";
      return { text };

    } catch (groqError: any) {
      console.error("Groq Fallback failed:", groqError);
      throw new Error("Both Gemini and Groq failed.");
    }
  } else {
    throw new Error("AI Service Unavailable (No Backup Key).");
  }
};

const generateWithCascade = async (
  params: any,
  useReasoning = false
): Promise<{ text: string }> => {
  
  // 1. CIRCUIT BREAKER CHECK
  if (checkCircuitBreaker()) {
      return await runGroqFallback(params);
  }

  let lastError: any;
  const ai = getAI();
  
  // 2. TRY GOOGLE GEMINI MODELS
  for (const modelName of GOOGLE_CASCADE) {
      try {
        const config = { ...params.config };
        
        // Add Thinking Config for supported models if reasoning is requested
        if (useReasoning && (modelName.includes('gemini-3') || modelName.includes('gemini-2.5'))) {
           config.thinkingConfig = { thinkingBudget: 1024 }; 
        }

        const response = await ai.models.generateContent({
          ...params,
          model: modelName,
          config
        });
        
        return { text: response.text || "" };

      } catch (error: any) {
        console.warn(`Gemini ${modelName} failed. Switching...`);
        lastError = error;
        if (error.message && error.message.includes("API Key")) throw error; 
        continue; 
      }
  }

  console.error("All Gemini models exhausted.");
  if (lastError?.message !== 'MISSING_GOOGLE_KEY') {
      tripCircuitBreaker();
  }

  return await runGroqFallback(params);
};

// --- AI FEATURE FUNCTIONS ---

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
          required: ['faceStatus', 'violationType', 'isPrank', 'reason']
        }
      }
    });

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e: any) {
    if (e.message === "MISSING_GOOGLE_KEY") console.warn("AI Security Scan Skipped");
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
            4. Visible PII text (phone numbers, addresses)

            Use 1000 as the scale (e.g. 500 = 50%).
          ` },
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            regions: {
              type: Type.ARRAY,
              items: { type: Type.ARRAY, items: { type: Type.NUMBER } }
            }
          }
        }
      }
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
            
            Categories: ${Object.values(ItemCategory).join(', ')}
            
            Instructions:
            1. Identify the main object.
            2. Determine the most appropriate category from the list.
            3. List visual tags (e.g., "blue", "scratched", "sticker").
            4. Extract brand name if visible.
          `},
          { inlineData: { mimeType: "image/jpeg", data: base64Data } }
        ]
      },
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            category: { type: Type.STRING, enum: Object.values(ItemCategory) },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            color: { type: Type.STRING },
            brand: { type: Type.STRING },
            condition: { type: Type.STRING },
            distinguishingFeatures: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['title', 'category', 'tags']
        }
      }
    }, true); // Use Reasoning
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
          - Keep it under 300 characters.
          - Do NOT repeat "AI detected". Just describe the item naturally.
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
    const parts: any[] = [{ text: `
      Task: Enhance description and validate content for a campus Lost & Found.
      Title: "${title}"
      Raw Input: "${description}"
      
      Instructions:
      1. Correct grammar and clarity.
      2. Extract Item Category (Electronics, Clothing, etc).
      3. Identify potential Policy Violations (Drugs, Weapons, Spam).
      4. Generate a concise summary and tags.
      5. Reasoning is enabled: Think about the category carefully based on the description and images.
    ` }];
    
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
            category: { type: Type.STRING, enum: Object.values(ItemCategory) },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            summary: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            distinguishingFeatures: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['isViolating', 'title', 'description', 'category']
        }
      }
    }, true); // Enable Reasoning for accurate categorization

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
      isViolating: false, isPrank: false, category: ItemCategory.OTHER, 
      title: title || "Item", description, distinguishingFeatures: [], summary: "", tags: [], faceStatus: 'NONE'
    } as any;
  }
};

export const parseSearchQuery = async (query: string): Promise<{ userStatus: 'LOST' | 'FOUND' | 'NONE'; refinedQuery: string }> => {
  try {
    const response = await generateWithCascade({
      contents: {
        parts: [{ text: `Determine intent (LOST/FOUND/NONE) and extract keywords for: "${query}".` }]
      },
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
             userStatus: { type: Type.STRING, enum: ['LOST', 'FOUND', 'NONE'] },
             refinedQuery: { type: Type.STRING }
          },
          required: ['userStatus', 'refinedQuery']
        }
      }
    });
    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e: any) {
    return { userStatus: 'NONE', refinedQuery: query };
  }
};

export const findPotentialMatches = async (
  query: { description: string; imageUrls: string[] },
  candidates: ItemReport[]
): Promise<{ id: string }[]> => {
  if (candidates.length === 0) return [];
  try {
    // Only send simplified candidate data to save tokens
    const candidateList = candidates.map(c => ({ 
        id: c.id, 
        title: c.title, 
        desc: c.description,
        cat: c.category,
        loc: c.location
    }));
    
    const parts: any[] = [{ text: `
      Task: Find items in Candidates that semantically match the Source.
      
      Source Description: ${query.description}
      Candidates: ${JSON.stringify(candidateList)}
      
      Instructions:
      1. Analyze the 'Source' item. Understand what it is.
      2. Iterate through 'Candidates'.
      3. MATCH IF: The items are likely the same physical object (e.g. "Lost iPhone" vs "Found Black iPhone").
      4. IGNORE IF: Categories or locations completely mismatch (e.g. "Lost Dog" vs "Found Keys").
      5. Strictness: High. Only return matches if you are >70% confident.
      
      Return a JSON object with a list of matched IDs.
    ` }];

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
             matches: {
                type: Type.ARRAY,
                items: {
                   type: Type.OBJECT,
                   properties: { 
                     id: { type: Type.STRING },
                     reason: { type: Type.STRING }
                   },
                   required: ['id']
                }
             }
          }
        }
      }
    }, true); // Enable Reasoning for better matching
    
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
    const parts: any[] = [{ text: `
      Compare Item A (${itemA.title}) and Item B (${itemB.title}).
      Are they the same object?
      Analyze visual similarity, description overlap, and logic (time/location).
      
      Reasoning required:
      - Check if the dates make sense (Lost date <= Found date).
      - Check if locations are plausibly close.
      - Check visual features (color, brand, damage).
    ` }];
    
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
            confidence: { type: Type.NUMBER, description: "Match percentage 0-100" },
            explanation: { type: Type.STRING },
            similarities: { type: Type.ARRAY, items: { type: Type.STRING } },
            differences: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['confidence', 'explanation', 'similarities', 'differences']
        }
      }
    }, true); // Enable Reasoning

    const text = response.text ? cleanJSON(response.text) : "{}";
    return JSON.parse(text);
  } catch (e: any) {
    if (e.message !== "MISSING_GOOGLE_KEY") console.error("Comparison Error", e);
    return { confidence: 0, explanation: "Comparison failed.", similarities: [], differences: [] };
  }
};
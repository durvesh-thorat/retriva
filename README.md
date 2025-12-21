
# RETRIVA - Intelligent Campus Lost & Found System

> **Team 4SCRIPT** presents a Next-Generation Recovery Platform powered by Multimodal AI.

## 📋 Overview

**RETRIVA** is a smart campus lost and found application designed to streamline the recovery of personal items. By replacing disorganized social media feeds and physical lost-and-found boxes with an intelligent, centralized platform, RETRIVA ensures that lost items are returned to their owners efficiently and securely.

The system leverages **Google Gemini 3.0** to perform semantic matching, meaning it understands that a "MacBook" reported lost is the same object as an "Apple Laptop" reported found. It handles the categorization, validation, and matching process autonomously, reducing administrative overhead and increasing recovery rates.

## ✨ Key Features

### 🤖 Multimodal AI Intelligence
- **Auto-Description:** Upload an image, and the system automatically extracts attributes (Brand, Color, Type, Condition) to populate the report.
- **Semantic Search:** Innovative vector-based matching finds items based on meaning, not just exact keywords.
- **Match Comparator:** A side-by-side comparison tool that uses AI to analyze two items and calculate a "Match Confidence Score" to help users verify ownership.

### 🛡️ Guardian AI Privacy & Safety
- **PII Redaction:** Automatically detects and blurs faces, student ID cards, and credit cards in uploaded images before they are published to protect student privacy.
- **Content Moderation:** Filters out spam, pranks, and inappropriate uploads instantly using visual analysis.

### ⚡ Real-Time Infrastructure
- **Instant Alerts:** Push-style notifications when a potential match is found.
- **Secure Messaging:** Built-in chat allows students to coordinate retrieval without sharing personal phone numbers.
- **Live Updates:** Status tracking (Open/Resolved) for all reports ensures the database remains current.

## 🛠️ Technology Stack

RETRIVA is built on a modern, scalable architecture:

*   **Frontend Framework:** React 19 (TypeScript)
*   **Styling:** Tailwind CSS + Lucide React Icons
*   **Artificial Intelligence:** Google Gemini API (Gemini 3.0 Flash & Pro)
*   **Backend & Database:** Google Firebase (Firestore, Authentication)
*   **Media Management:** Cloudinary API
*   **Build Tool:** Vite

## 🚀 Getting Started

To set up the project locally, follow these steps:

### Prerequisites
*   Node.js (v18 or higher)
*   A Firebase Project
*   A Google Cloud Project with Gemini API enabled
*   A Cloudinary Account

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/retriva.git
    cd retriva
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root directory and add your API keys:
    ```env
    VITE_API_KEY=your_gemini_api_key
    ```
    *Note: Firebase and Cloudinary configurations are currently handled in `src/services/firebase.ts` and `src/services/cloudinary.ts` respectively.*

4.  **Run the application**
    ```bash
    npm start
    ```

## 👥 The Team (4SCRIPT)

This project was developed by First Year Engineering students from **Pillai College of Engineering**:

*   **Durvesh Thorat** - Information Technology
*   **Kaustubh Bhoir** - Computer Engineering
*   **Nipun Tamore** - Information Technology
*   **Srushtee Gawande** - Information Technology

## 📄 License

This project is created for educational purposes. All rights reserved by Team 4SCRIPT.

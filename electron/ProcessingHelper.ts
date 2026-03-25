// ProcessingHelper.ts - Groq Only Version
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { configHelper } from "./ConfigHelper"
import Groq from 'groq-sdk';

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private groqClient: Groq | null = null

  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    this.initializeAIClient();
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }

  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();
      if (config.apiKey) {
        this.groqClient = new Groq({ apiKey: config.apiKey });
        console.log("Groq client initialized successfully");
      } else {
        this.groqClient = null;
        console.warn("No API key available, Groq client not initialized");
      }
    } catch (error) {
      console.error("Failed to initialize Groq client:", error);
      this.groqClient = null;
    }
  }

  private async waitForInitialization(mainWindow: BrowserWindow): Promise<void> {
    return new Promise((resolve) => {
      const checkInitialized = async () => {
        try {
          const initialized = await mainWindow.webContents.executeJavaScript("window.__INITIALIZED__");
          if (initialized) {
            resolve();
          } else {
            setTimeout(checkInitialized, 100);
          }
        } catch {
          setTimeout(checkInitialized, 100);
        }
      };
      checkInitialized();
    });
  }

  private async getLanguage(): Promise<string> {
    try {
      const configLanguage = configHelper.getLanguage();
      if (configLanguage) return configLanguage;
      const mainWindow = this.deps.getMainWindow();
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow);
          const language = await mainWindow.webContents.executeJavaScript("window.__LANGUAGE__");
          if (typeof language === "string") return language;
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      return "python";
    } catch (error) {
      console.error("Error getting language:", error);
      return "python";
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) return;

    if (!this.groqClient) {
      this.initializeAIClient();
      if (!this.groqClient) {
        console.error("Groq client not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    }

    const view = this.deps.getView();
    console.log("Processing screenshots in view:", view);

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      console.log("Processing main queue screenshots:", screenshotQueue);

      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        this.currentProcessingAbortController = new AbortController();
        const { signal } = this.currentProcessingAbortController;

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        );

        const validScreenshots = screenshots.filter(Boolean) as Array<{ path: string; preview: string; data: string }>;
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        mainWindow.webContents.send("screenshots-updated", {
          previews: validScreenshots.map(s => s.preview),
          paths: validScreenshots.map(s => s.path)
        });

        const result = await this.processScreenshotsHelper(validScreenshots, signal);

        if (result.success) {
          this.deps.setProblemInfo(result.data);
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, result.data);
        } else {
          console.error("Processing failed:", result.error);
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, result.error);
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, "Processing was canceled.");
        } else {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message);
        }
      } finally {
        this.currentProcessingAbortController = null;
      }
    } else if (view === "solutions") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START);
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      const extraQueue = this.screenshotHelper.getExtraScreenshotQueue();
      const allPaths = [...screenshotQueue, ...extraQueue];

      if (allPaths.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, "No screenshots available.");
        return;
      }

      try {
        this.currentExtraProcessingAbortController = new AbortController();
        const { signal } = this.currentExtraProcessingAbortController;

        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) return null;
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        );

        const validScreenshots = screenshots.filter(Boolean) as Array<{ path: string; preview: string; data: string }>;
        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }

        const result = await this.processExtraScreenshotsHelper(validScreenshots, signal);

        if (result.success) {
          this.deps.setHasDebugged(true);
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS, result.data);
        } else {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, result.error);
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, "Processing was canceled.");
        } else {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, error.message);
        }
      } finally {
        this.currentExtraProcessingAbortController = null;
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      const imageDataList = screenshots.map(screenshot => screenshot.data);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", { message: "Analyzing problem from screenshots...", progress: 20 });
      }

      if (!this.groqClient) {
        return { success: false, error: "Groq API key not configured. Please check your settings." };
      }

      let problemInfo;

      try {
        const messages = [
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: `You are a coding challenge interpreter. Extract the coding problem details from these screenshots. Return in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text. Preferred coding language is ${language}.`
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        const response = await this.groqClient.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        const responseText = response.choices[0].message.content || "";
        const jsonText = responseText.replace(/```json|```/g, '').trim();
        problemInfo = JSON.parse(jsonText);
      } catch (error: any) {
        console.error("Error using Groq API:", error);
        if (error.status === 429) {
          return { success: false, error: "Groq API rate limit exceeded. Please wait a moment before trying again." };
        }
        return { success: false, error: "Failed to process with Groq API. Please check your API key or try again later." };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", { message: "Generating solution...", progress: 60 });
      }

    const promptText = `Problem: ${problemInfo.problem_statement}\n\nConstraints: ${problemInfo.constraints}\n\nExample Input: ${problemInfo.example_input}\n\nExample Output: ${problemInfo.example_output}\n\nProvide two solutions in ${language}:\n1. Bruteforce Solution\n2. Optimal Solution\n\nFor each solution, include:\n- The complete, working code\n- Brief explanation of approach\n- Time and space complexity`;

      let responseContent;

      try {
        const solutionResponse = await this.groqClient.chat.completions.create({
          model: config.solutionModel || "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations." },
            { role: "user", content: promptText }
          ],
          max_tokens: 4000,
          temperature: 0.2
        });

        responseContent = solutionResponse.choices[0].message.content || "";
      } catch (error: any) {
        console.error("Error using Groq API for solution:", error);
        if (error.status === 429) {
          return { success: false, error: "Groq API rate limit exceeded. Please wait a moment before trying again." };
        }
        return { success: false, error: "Failed to generate solution with Groq API." };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", { message: "Processing complete", progress: 100 });
      }

      // Extract code from response
      let code = "";
      const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      if (codeMatch) {
        code = codeMatch[1].trim();
      } else {
        code = responseContent;
      }

      // Extract complexity
      const timeMatch = responseContent.match(/time\s*complexity[:\s]*O\([^)]+\)/i);
      const spaceMatch = responseContent.match(/space\s*complexity[:\s]*O\([^)]+\)/i);

      const response = {
        ...problemInfo,
        code,
        thoughts: [responseContent.substring(0, 500)],
        time_complexity: timeMatch ? timeMatch[0] : "See solution explanation",
        space_complexity: spaceMatch ? spaceMatch[0] : "See solution explanation"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Processing error:", error);
      return { success: false, error: error.message || "Processing failed" };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", { message: "Processing debug screenshots...", progress: 30 });
      }

      const imageDataList = screenshots.map(screenshot => screenshot.data);

      if (!this.groqClient) {
        return { success: false, error: "Groq API key not configured. Please check your settings." };
      }

      let debugContent;

      try {
        const debugPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Please analyze these screenshots and provide:
1. Issues identified in the code
2. Specific improvements and corrections
3. Any optimizations
4. Clear explanation of changes needed

Use these section headers:
### Issues Identified
### Specific Improvements
### Optimizations
### Explanation`;

        const messages = [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: debugPrompt },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", { message: "Analyzing code with Groq...", progress: 60 });
        }

        const response = await this.groqClient.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        debugContent = response.choices[0].message.content || "";
      } catch (error: any) {
        console.error("Error using Groq API for debugging:", error);
        if (error.status === 429) {
          return { success: false, error: "Groq API rate limit exceeded. Please wait a moment before trying again." };
        }
        return { success: false, error: "Failed to process debug request with Groq API." };
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", { message: "Debug analysis complete", progress: 100 });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      const bulletPoints = debugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];

      const response = {
        code: extractedCode,
        debug_analysis: debugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false;

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort();
      this.currentProcessingAbortController = null;
      wasCancelled = true;
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort();
      this.currentExtraProcessingAbortController = null;
      wasCancelled = true;
    }

    this.deps.setHasDebugged(false);
    this.deps.setProblemInfo(null);

    const mainWindow = this.deps.getMainWindow();
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
    }
  }
}

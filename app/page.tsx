'use client';

import { useState, useEffect, useRef } from 'react';
import { Sandpack, SandpackProvider, SandpackLayout, SandpackCodeEditor, SandpackPreview } from '@codesandbox/sandpack-react';
import { ArrowLongRightIcon, SparklesIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

async function* readStream(response: Response) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) return;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch (e) {
            console.error('Error parsing JSON:', e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default function Page() {
  const [prompt, setPrompt] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [fixPrompt, setFixPrompt] = useState('');
  const [showFixInput, setShowFixInput] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixAttempts, setAutoFixAttempts] = useState(0);
  const [lastError, setLastError] = useState('');

  async function createApp(e: React.FormEvent) {
    e.preventDefault();
    setGeneratedCode('');
    setIsGenerating(true);
    setMessages([{ role: 'user', content: prompt }]);
    setShowFixInput(false);
    setHasError(false);
    setAutoFixAttempts(0);

    try {
      const res = await fetch('/api/generateCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt,
          messages: []
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      let fullCode = '';
      for await (const result of readStream(res)) {
        if (result.choices) {
          const newText = result.choices.map((c: any) => c.text || '').join('');
          fullCode += newText;
          
          // Check if we have cleaned code (final chunk)
          if (result.choices[0]?.cleanedCode !== undefined) {
            fullCode = result.choices[0].cleanedCode;
          }
          
          setGeneratedCode(fullCode);
        }
      }
      
      setMessages(prev => [...prev, { role: 'assistant', content: fullCode }]);
      setShowFixInput(true);
      
      // Start error checking after a delay
      setTimeout(() => {
        checkForErrors();
      }, 3000);
    } catch (error) {
      console.error('Error generating code:', error);
      alert('Failed to generate code. Please try again.');
    } finally {
      setIsGenerating(false);
      setPrompt('');
    }
  }

  async function fixCode(e: React.FormEvent | null, customFixPrompt?: string) {
    if (e) e.preventDefault();
    const fixRequest = customFixPrompt || fixPrompt;
    if (!fixRequest.trim()) return;

    setIsGenerating(true);
    const newMessages = [
      ...messages,
      { role: 'user' as const, content: fixRequest }
    ];
    setMessages(newMessages);

    try {
      const res = await fetch('/api/generateCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: fixRequest,
          messages: newMessages,
          currentCode: generatedCode
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      let fullCode = '';
      for await (const result of readStream(res)) {
        if (result.choices) {
          const newText = result.choices.map((c: any) => c.text || '').join('');
          fullCode += newText;
          
          // Check if we have cleaned code (final chunk)
          if (result.choices[0]?.cleanedCode !== undefined) {
            fullCode = result.choices[0].cleanedCode;
          }
          
          setGeneratedCode(fullCode);
        }
      }
      
      setMessages(prev => [...prev, { role: 'assistant', content: fullCode }]);
      setFixPrompt('');
      setHasError(false);
      
      // Check for errors again after fix
      setTimeout(() => {
        checkForErrors();
      }, 3000);
    } catch (error) {
      console.error('Error fixing code:', error);
      alert('Failed to fix code. Please try again.');
    } finally {
      setIsGenerating(false);
      setIsAutoFixing(false);
    }
  }

  // Check for errors by looking at the preview iframe
  function checkForErrors() {
    if (isGenerating || isAutoFixing || autoFixAttempts >= 3) return;

    // Try to find the preview iframe
    const iframe = document.querySelector('iframe[title="Sandpack Preview"]') as HTMLIFrameElement;
    if (!iframe) return;

    try {
      // Check if iframe has any error messages
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      const errorElements = iframeDoc.querySelectorAll('.sp-error, .error-message, [data-error="true"]');
      const bodyText = iframeDoc.body?.innerText || '';
      
      let errorMessage = '';
      
      // Check for common error patterns in the body text
      if (bodyText.includes('Cannot find module') || bodyText.includes('Module not found')) {
        const match = bodyText.match(/Cannot find module ['"]([^'"]+)['"]/);
        if (match) {
          errorMessage = `Cannot find module '${match[1]}'`;
        }
      } else if (bodyText.includes('is not defined')) {
        const match = bodyText.match(/(\w+) is not defined/);
        if (match) {
          errorMessage = `${match[1]} is not defined`;
        }
      } else if (errorElements.length > 0) {
        errorMessage = errorElements[0].textContent || 'Unknown error';
      }

      if (errorMessage && errorMessage !== lastError) {
        setLastError(errorMessage);
        setHasError(true);
        autoFixError(errorMessage);
      }
    } catch (e) {
      // Iframe access might be restricted, that's okay
    }
  }

  // Auto-fix function
  async function autoFixError(errorMessage: string) {
    if (isAutoFixing || autoFixAttempts >= 3) return;
    
    setIsAutoFixing(true);
    setAutoFixAttempts(prev => prev + 1);
    
    // Create a specific fix prompt based on the error
    let autoFixPrompt = `Fix this error: ${errorMessage}`;
    
    // Add specific instructions based on error type
    if (errorMessage.includes('Cannot find module') || errorMessage.includes('Module not found')) {
      const moduleMatch = errorMessage.match(/["']([^"']+)["']/);
      const moduleName = moduleMatch ? moduleMatch[1] : '';
      autoFixPrompt = `Fix the import error for module "${moduleName}". If this is an external library, remove it and implement the functionality using only React, TypeScript, and Tailwind CSS. If it's a typo, correct it.`;
    } else if (errorMessage.includes('is not defined')) {
      const undefinedMatch = errorMessage.match(/(\w+) is not defined/);
      const undefinedVar = undefinedMatch ? undefinedMatch[1] : '';
      autoFixPrompt = `Fix the error: "${undefinedVar} is not defined". Make sure to properly import or define this variable/function.`;
    }
    
    await fixCode(null, autoFixPrompt);
  }

  // Periodic error checking
  useEffect(() => {
    if (generatedCode && !isGenerating) {
      const interval = setInterval(() => {
        checkForErrors();
      }, 5000);
      
      return () => clearInterval(interval);
    }
  }, [generatedCode, isGenerating, autoFixAttempts]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <SparklesIcon className="w-10 h-10 text-blue-500" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Artifacts
            </h1>
            <SparklesIcon className="w-10 h-10 text-purple-500" />
          </div>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Generate interactive React applications with a single prompt
          </p>
        </div>

        {!generatedCode && (
          <form onSubmit={createApp} className="max-w-3xl mx-auto">
            <div className="flex gap-3 p-2 bg-white rounded-xl shadow-lg border border-gray-200">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Build me a modern calculator app with a sleek design..."
                className="flex-1 px-4 py-3 bg-transparent border-none focus:outline-none text-gray-800 placeholder-gray-400"
                required
                disabled={isGenerating}
              />
              <button
                type="submit"
                disabled={isGenerating}
                className="px-6 py-3 text-white bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 font-medium"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <span>Generate</span>
                    <ArrowLongRightIcon className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {generatedCode && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-gray-200">
              <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white px-6 py-3 flex items-center justify-between">
                <span className="font-medium">Generated React Component</span>
                <div className="flex items-center gap-4">
                  {isAutoFixing && (
                    <span className="text-sm bg-yellow-500/20 text-yellow-200 px-3 py-1 rounded-md flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-yellow-200 border-t-transparent rounded-full animate-spin" />
                      Auto-fixing errors... (Attempt {autoFixAttempts}/3)
                    </span>
                  )}
                  <span className="text-sm text-gray-300">TypeScript + Tailwind CSS</span>
                  <button
                    onClick={() => {
                      setGeneratedCode('');
                      setMessages([]);
                      setShowFixInput(false);
                      setFixPrompt('');
                      setHasError(false);
                      setAutoFixAttempts(0);
                      setLastError('');
                    }}
                    className="text-sm bg-white/20 hover:bg-white/30 px-3 py-1 rounded-md transition-colors"
                  >
                    Start Over
                  </button>
                </div>
              </div>
              <Sandpack
                template="react-ts"
                theme="dark"
                files={{
                  '/App.tsx': generatedCode,
                  '/index.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
                  '/public/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated React App</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {}
        }
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`,
                }}
                options={{
                  showLineNumbers: true,
                  showInlineErrors: true,
                  wrapContent: true,
                  editorHeight: 500,
                  bundlerURL: "https://sandpack-bundler.vercel.app",
                  showConsole: true,
                  showConsoleButton: true,
                }}
                customSetup={{
                  dependencies: {
                    "react": "^18.2.0",
                    "react-dom": "^18.2.0",
                    "@types/react": "^18.2.0",
                    "@types/react-dom": "^18.2.0",
                    "typescript": "^5.0.0"
                  }
                }}
              />
            </div>

            {showFixInput && (
              <form onSubmit={fixCode} className="max-w-3xl mx-auto">
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-gray-700">
                    <WrenchScrewdriverIcon className="w-5 h-5" />
                    <span className="font-medium">Need to modify the code?</span>
                  </div>
                  <div className="flex gap-3">
                    <input
                      value={fixPrompt}
                      onChange={(e) => setFixPrompt(e.target.value)}
                      placeholder="Add a dark mode toggle button in the top right corner..."
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isGenerating}
                    />
                    <button
                      type="submit"
                      disabled={isGenerating || !fixPrompt.trim()}
                      className="px-6 py-2 text-white bg-gradient-to-r from-green-500 to-teal-600 rounded-lg hover:from-green-600 hover:to-teal-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 font-medium"
                    >
                      {isGenerating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Fixing...</span>
                        </>
                      ) : (
                        <>
                          <span>Fix Code</span>
                          <WrenchScrewdriverIcon className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {messages.length > 2 && (
              <div className="max-w-3xl mx-auto">
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-700 mb-3">Modification History</h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {messages.slice(2).map((msg, idx) => (
                      msg.role === 'user' && (
                        <div key={idx} className="text-sm text-gray-600 flex items-start gap-2">
                          <span className="text-blue-500 mt-0.5">•</span>
                          <span>{msg.content}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
import Together from 'together-ai';

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

const systemPrompt = `You are an expert React developer and UI/UX designer. Create a single React component based on the user's request.

CRITICAL RULES:
1. Return ONLY the React component code, starting with imports
2. NO markdown code blocks (no \`\`\`typescript, \`\`\`jsx, etc.)
3. NO explanatory text before or after the code
4. The code must be a complete, self-contained component
5. NEVER wrap the code in triple backticks or any markdown formatting
6. Start directly with the import statements

TECHNICAL REQUIREMENTS:
- Use TypeScript for all components
- Use default export: export default function ComponentName()
- Import React hooks explicitly: import { useState, useEffect } from 'react';
- Make components fully functional with no required props
- Include proper TypeScript types for state and handlers

STYLING GUIDELINES:
- Use Tailwind CSS classes for all styling
- NEVER use arbitrary values (e.g., h-[600px], w-[300px])
- Use Tailwind's predefined classes only:
  * Spacing: p-4, m-2, gap-4
  * Sizing: w-full, h-screen, max-w-4xl
  * Colors: bg-blue-500, text-gray-700, border-gray-200
  * Flexbox/Grid: flex, grid, items-center, justify-between
  * Responsive: sm:, md:, lg: prefixes

DESIGN PRINCIPLES:
- Create visually appealing, modern interfaces
- Use proper spacing with consistent padding/margins
- Include hover states and transitions for interactive elements
- Ensure good contrast and readability
- Add subtle shadows and rounded corners where appropriate

COMPONENT FEATURES:
- Make it interactive with proper state management
- Include animations/transitions for better UX
- Handle edge cases and loading states
- Add proper accessibility attributes
- Use semantic HTML elements

IMPORTANT: Start your response with "import" and end with the closing brace of the export. No other text.`;

const fixPrompt = `You are an expert React developer. The user wants to modify the existing React component code.

CRITICAL RULES:
1. Return ONLY the complete updated React component code
2. NO markdown code blocks (no \`\`\`typescript, \`\`\`tsx, \`\`\`jsx, \`\`\`)
3. NEVER wrap the code in triple backticks
4. Start directly with import statements
5. Keep all existing functionality unless explicitly asked to remove it
6. Maintain the same code structure and style

When fixing or modifying:
- Fix any errors in the code
- Add the requested features or modifications
- Ensure the code still works properly
- Keep using TypeScript and Tailwind CSS
- Maintain all imports and exports
- NEVER import external libraries that aren't available (only use React, TypeScript, and browser APIs)
- If an external library is causing issues, implement the functionality using vanilla JavaScript/TypeScript

IMPORTANT: Your response must start with "import" and end with the closing brace of the export. Nothing else.

Current code is provided below. Modify it according to the user's request and return ONLY the complete updated code.`;

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const { prompt, messages = [], currentCode } = json;

    // Determine if this is a fix request or initial generation
    const isFixRequest = messages.length > 0 && currentCode;

    // Build the messages array
    let conversationMessages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
    }> = [];
    
    if (isFixRequest) {
      // For fix requests, include the context
      conversationMessages = [
        {
          role: 'system' as const,
          content: fixPrompt,
        },
        {
          role: 'user' as const,
          content: `Current code:\n\n${currentCode}\n\nUser request: ${prompt}`,
        }
      ];
    } else {
      // For initial generation
      conversationMessages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        {
          role: 'user' as const,
          content: prompt,
        }
      ];
    }

    const response = await together.chat.completions.create({
      model: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      messages: conversationMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    });

    // Create a custom stream that formats the response properly
    const stream = new ReadableStream({
      async start(controller) {
        let buffer = '';
        
        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) {
            buffer += text;
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ choices: [{ text }] }) + '\n'
              )
            );
          }
        }
        
        // Clean up the final code if it contains markdown blocks
        if (buffer.includes('```')) {
          // Remove markdown code blocks
          let cleanedCode = buffer;
          cleanedCode = cleanedCode.replace(/```typescript\n?/gi, '');
          cleanedCode = cleanedCode.replace(/```tsx\n?/gi, '');
          cleanedCode = cleanedCode.replace(/```jsx\n?/gi, '');
          cleanedCode = cleanedCode.replace(/```javascript\n?/gi, '');
          cleanedCode = cleanedCode.replace(/```\n?/g, '');
          cleanedCode = cleanedCode.trim();
          
          // Send a final chunk with the cleaned code
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ choices: [{ text: '', cleanedCode }] }) + '\n'
            )
          );
        }
        
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in generateCode API:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate code' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
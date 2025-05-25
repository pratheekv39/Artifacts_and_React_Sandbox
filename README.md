# Artifacts

Artifacts is a Next.js application that generates React applications using Llama 3.1 405B through Together AI's API. It allows users to create React applications with a single prompt.

## Features

- Generate React applications with natural language prompts
- Real-time code streaming
- Live preview using Sandpack
- TypeScript support
- Tailwind CSS styling
- Modern UI/UX

## Prerequisites

- Node.js 18+ installed
- Together AI API key

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd llamacoder
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory and add your Together AI API key:
```
TOGETHER_API_KEY=your_api_key_here
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a prompt describing the React application you want to create
2. Click the submit button or press Enter
3. Wait for the code to be generated
4. The generated application will be displayed in the Sandpack preview

## Technologies Used

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Together AI API
- Sandpack
- Llama 3.1 405B

## License

MIT 

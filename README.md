# Slack Scrapping Extension

A Chrome extension built with TypeScript and React for scraping Slack data.

## Features

- Scrape Slack messages, channels, and users
- Real-time data collection
- Export data to JSON
- Modern React UI
- TypeScript for type safety

## Development Setup

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. For development with watch mode:
```bash
npm run dev
```

## Loading the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist` folder
4. The extension will be loaded and ready to use

## Usage

1. Navigate to any Slack workspace
2. Click the extension icon to open the popup
3. Click "Start Scraping" to begin data collection
4. Use "Export Data" to download collected data as JSON
5. Click "Stop Scraping" to halt data collection

## Project Structure

```
src/
├── popup/           # React popup UI
│   ├── App.tsx     # Main popup component
│   ├── App.css     # Popup styles
│   ├── index.tsx   # Popup entry point
│   └── index.html  # Popup HTML template
├── content/        # Content script for Slack scraping
│   └── index.ts    # Content script entry point
└── background/     # Background service worker
    └── index.ts    # Background script entry point

public/
└── manifest.json   # Chrome extension manifest

dist/               # Built extension files (generated)
```

## Permissions

- `activeTab`: Access to the current tab
- `storage`: Local storage for extension data
- `scripting`: Inject content scripts
- `https://*.slack.com/*`: Access to Slack domains

## Building

The extension uses Webpack to bundle TypeScript and React code. The build process:

1. Compiles TypeScript to JavaScript
2. Bundles React components
3. Copies static files to `dist/`
4. Generates the final extension package

## Development

- Use `npm run dev` for development with file watching
- Use `npm run build` for production builds
- Use `npm run type-check` to verify TypeScript types
- Use `npm run clean` to remove build artifacts

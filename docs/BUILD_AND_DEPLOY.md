# Slack Scrapping Extension - Build & Deployment

## Quick Start

```bash
# Install dependencies
npm install

# Development build (with file watching)
npm run dev

# Production build (optimized)
npm run build

# Type checking
npm run type-check

# Clean build artifacts
npm run clean
```

---

## Development Workflow

### 1. Initial Setup

```bash
# Clone or open project
cd slack-scrapping-extension

# Install all dependencies
npm install
```

### 2. Development Build with Watch

```bash
npm run dev
```

This command:
- Runs webpack in development mode
- Watches for file changes
- Rebuilds automatically on save
- Outputs to `dist/` folder
- Generates source maps for easier debugging

**When to use:** During active development

### 3. Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer Mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/` folder from your project
5. Extension should appear in your list

### 4. Make Changes

Edit files in `src/`:
- `src/popup/App.tsx` - React UI changes
- `src/popup/App.css` - Styling changes
- `src/content/index.ts` - Scraping logic changes
- `src/background/index.ts` - Lifecycle changes

webpack automatically rebuilds on save.

### 5. Reload in Chrome

After webpack finishes rebuilding:
1. Go to `chrome://extensions/`
2. Find your extension
3. Click the refresh icon (or press Ctrl+R)
4. Changes take effect

### 6. Debug

**Content Script Console:**
- Open any Slack page in Chrome
- Right-click → Inspect
- Go to Console tab
- You'll see logs from content script

**Popup Console:**
- Right-click extension icon
- Click "Inspect"
- Console shows popup logs

**Service Worker Console:**
- Go to chrome://extensions/
- Find your extension
- Click "Service Worker" link
- New tab opens with service worker logs

---

## Production Build

### Build for Distribution

```bash
npm run build
```

This command:
- Runs webpack in production mode
- Minifies JavaScript
- Removes source maps
- Optimizes bundle size
- Outputs to `dist/` folder

**When to use:** Before packaging or distributing

### Output Verification

After building, verify `dist/` contains:
```
dist/
├── popup.js          (minified React bundle)
├── popup.html        (generated HTML)
├── content.js        (minified content script)
├── background.js     (minified service worker)
├── manifest.json     (extension manifest)
└── [vendor-*.js]     (extracted dependencies)
```

### File Size Check

Verify bundle sizes (minified):
- `popup.js`: ~80-120 KB
- `content.js`: ~60-100 KB
- `background.js`: <10 KB
- Total: ~150-230 KB

---

## Build Configuration (webpack.config.js)

### Entry Points

```javascript
entry: {
  popup: './src/popup/index.tsx',      // React UI
  content: './src/content/index.ts',   // DOM scraping
  background: './src/background/index.ts' // Service worker
}
```

Three separate bundles are created:
1. **popup.js** - React application
2. **content.js** - Content script (injected into Slack pages)
3. **background.js** - Service worker (extension lifecycle)

### Output Configuration

```javascript
output: {
  path: path.resolve(__dirname, 'dist'),  // Output directory
  filename: '[name].js',                  // File naming: popup.js, content.js, background.js
  clean: true                             // Remove old files before build
}
```

### Loaders

**TypeScript Loader:**
```javascript
{
  test: /\.tsx?$/,
  loader: 'ts-loader',
  exclude: /node_modules/
}
```
- Transpiles TypeScript → JavaScript
- Applies tsconfig.json settings

**CSS Loader:**
```javascript
{
  test: /\.css$/i,
  use: ['style-loader', 'css-loader']
}
```
- Processes CSS imports
- Injects styles into DOM

### Plugins

**HtmlWebpackPlugin:**
```javascript
new HtmlWebpackPlugin({
  template: './src/popup/index.html',
  filename: 'popup.html',
  chunks: ['popup']  // Only popup.js in this HTML
})
```
- Generates `dist/popup.html`
- Injects popup.js script tag
- Uses src/popup/index.html as template

**CopyWebpackPlugin:**
```javascript
new CopyWebpackPlugin({
  patterns: [{ from: 'public', to: '.' }]
})
```
- Copies manifest.json from public/ to dist/
- Preserves file structure

### Optimization

```javascript
optimization: {
  splitChunks: { chunks: 'all' }
}
```
- Extracts common code into separate chunks
- Named as `[vendor-hash].js`
- Reduces duplication across bundles

---

## TypeScript Configuration (tsconfig.json)

### Compiler Options

```json
{
  "target": "ES2020",           // Modern JavaScript
  "lib": ["DOM", "DOM.Iterable", "ES6"],  // Browser APIs + ES6
  "jsx": "react-jsx",           // React 17+ JSX transform
  "strict": true,               // Strict type checking
  "module": "CommonJS",         // CommonJS modules
  "skipLibCheck": true,         // Faster compilation
  "esModuleInterop": true,      // Better module compatibility
}
```

### Type Checking

Run type checker without emitting files:
```bash
npm run type-check
```

Output example:
```
src/content/index.ts:42:5 - error TS2345: Argument of type '{}' is not assignable to parameter of type 'SlackData'.
  Property 'messages' is missing in type '{}'.
```

### Path Aliases

```json
"paths": {
  "@/*": ["src/*"]
}
```

Allows imports like:
```typescript
import App from '@/popup/App'
import { SlackData } from '@/types'
```

---

## ESLint Configuration (.eslintrc.json)

### Rules

```json
{
  "extends": [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended"
  ]
}
```

### Enforced Rules

- No unused variables (warning)
- No explicit `any` type (warning)
- React component JSX scope check (off for React 17+)
- React Hooks rules (off, off-by-one errors)

### Running ESLint

```bash
# Check for linting issues (if configured in package.json)
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```

---

## Environment Setup

### Requirements

- **Node.js:** v14 or higher
- **npm:** v6 or higher
- **Chrome:** v88+ (Manifest v3 support)

### Verify Installation

```bash
node --version      # Should be v14+
npm --version       # Should be v6+
npm list webpack    # Should show webpack is installed
```

### Install Dependencies

```bash
npm install
```

**What gets installed:**
- **React & React DOM** - UI framework (runtime)
- **Webpack & webpack-cli** - Bundler
- **TypeScript & ts-loader** - Language & transpiler
- **ESLint & plugins** - Code quality
- **Various loaders & plugins** - Build tools

---

## Build Process Flow

```
npm run build (or npm run dev)
    │
    ▼
Webpack starts with three entry points
    │
    ├─▶ src/popup/index.tsx
    │   └─▶ ts-loader transpiles to JavaScript
    │       └─▶ Bundles React + dependencies
    │           └─▶ Outputs: dist/popup.js
    │
    ├─▶ src/content/index.ts
    │   └─▶ ts-loader transpiles to JavaScript
    │       └─▶ Bundles SlackScraper class
    │           └─▶ Outputs: dist/content.js
    │
    └─▶ src/background/index.ts
        └─▶ ts-loader transpiles to JavaScript
            └─▶ Minimal bundle
                └─▶ Outputs: dist/background.js

Parallel processing:
    ├─▶ CSS files processed (style-loader + css-loader)
    ├─▶ Source maps generated (dev only)
    └─▶ Common code extracted (splitChunks)

Plugins execute:
    ├─▶ HtmlWebpackPlugin
    │   └─▶ Generates dist/popup.html
    │       └─▶ Injects <script src="popup.js"></script>
    │
    └─▶ CopyWebpackPlugin
        └─▶ Copies public/manifest.json → dist/manifest.json

Output directory:
    └─▶ dist/ folder ready for Chrome
        ├─ popup.js (minified if production)
        ├─ popup.html
        ├─ content.js (minified if production)
        ├─ background.js (minified if production)
        ├─ manifest.json
        └─ vendor-*.js (split chunks)
```

---

## Common Build Tasks

### Task: Add a New File

1. Create file in `src/` directory
2. Import/export as needed
3. If new entry point, add to webpack.config.js entry
4. Build automatically rebuilds

### Task: Update Dependencies

```bash
# Install new package
npm install package-name

# Install dev dependency
npm install --save-dev package-name

# Update package.json
npm update

# Check for outdated packages
npm outdated
```

### Task: Fix TypeScript Errors

```bash
# Run type checker
npm run type-check

# View all errors
npm run type-check 2>&1 | head -20

# Fix errors in IDE or manually
```

### Task: Optimize Bundle Size

1. Check current sizes:
```bash
npm run build
ls -lh dist/*.js
```

2. Analyze bundle (if webpack-bundle-analyzer installed):
```bash
npx webpack-bundle-analyzer dist/popup.js
```

3. Optimize:
   - Remove unused dependencies
   - Code split large files
   - Use production build
   - Lazy load components

---

## Deployment Options

### Option 1: Local Development

1. Run `npm run dev`
2. Load unpacked in `chrome://extensions/`
3. Refresh after changes
4. **Use for:** Development and testing

### Option 2: Manual Distribution

1. Run `npm run build`
2. Zip contents of `dist/` folder
3. Share `.zip` file with users
4. Users load unpacked from extracted folder
5. **Use for:** Team sharing, internal distribution

### Option 3: Chrome Web Store

1. Create developer account
2. Run `npm run build`
3. Prepare images/descriptions
4. Upload `dist/` folder to store
5. Submit for review
6. **Use for:** Public distribution

**Note:** This extension performs user automation and data scraping. Review Chrome Web Store policies before publishing.

### Option 4: Enterprise/Internal

1. Create signed `.crx` file
2. Distribute via MDM/Group Policy
3. Users auto-install via policy
4. **Use for:** Enterprise deployment

---

## Troubleshooting

### Issue: Module Not Found

**Error:** `Cannot find module '@/popup/App'`

**Solution:**
1. Check file path in tsconfig.json paths
2. Verify file exists
3. Check import statement spelling
4. Rebuild: `npm run build`

### Issue: Extension Not Updating After Changes

**Solution:**
1. Ensure webpack rebuild completed
2. Go to `chrome://extensions/`
3. Click refresh icon on extension
4. Close and reopen popup
5. Hard refresh: Ctrl+Shift+R

### Issue: "Service Worker stopped"

**Error:** Service worker terminated after 5 minutes of inactivity

**Reason:** Chrome v3 manifest limitation

**Workaround:**
1. Keep popup open during long operations
2. Use content script for long-running tasks
3. Re-initialize in onMessage listener

### Issue: DOM Selectors Not Finding Elements

**Error:** `console.warn: "message editor not found"`

**Cause:** Slack updated their HTML structure

**Solution:**
1. Inspect Slack page with DevTools
2. Find new selector for element
3. Update selector in src/content/index.ts
4. Rebuild and reload

### Issue: TypeScript Type Errors

**Error:** `error TS2339: Property 'xyz' does not exist on type 'Window'`

**Solution:**
1. Check types installed: `npm list @types/chrome`
2. Add type declaration: `declare global { ... }`
3. Or use `as any` (not recommended)
4. Or install missing @types package

### Issue: Build Hangs or Fails

**Solution:**
1. Stop webpack: Ctrl+C
2. Clear cache: `rm -rf node_modules dist && npm install`
3. Rebuild: `npm run build`
4. Check disk space (50MB+ free)
5. Check Node version: `node --version`

---

## Performance Optimization

### Development Build Optimization

```bash
# Faster development builds
npm run dev -- --no-source-map
```

### Production Build Optimization

```bash
# Already optimized with:
# - Minification
# - Tree-shaking
# - Source map removal
# - Chunk splitting

npm run build
```

### Code Splitting Strategy

Current implementation splits:
- Common vendor code → `vendor-*.js`
- Content script → `content.js` (isolated)
- Popup → `popup.js` (isolated)
- Background → `background.js` (isolated)

**Result:** Each context loads only what it needs

---

## Version Management

### Current Version

Located in `package.json`:
```json
{
  "version": "1.0.0"
}
```

### Update Version

```bash
# Manual edit
# Change "version": "1.0.0" to "1.0.1"

# Or use npm
npm version minor  # 1.0.0 → 1.1.0
npm version patch  # 1.0.0 → 1.0.1
npm version major  # 1.0.0 → 2.0.0
```

### Extension Manifest Version

Located in `public/manifest.json`:
```json
{
  "version": "1.0.0"
}
```

**Keep package.json and manifest.json versions in sync.**

---

## CI/CD Pipeline (Optional)

### GitHub Actions Example

Create `.github/workflows/build.yml`:

```yaml
name: Build Extension

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run type-check
      - run: npm run build
      - uses: actions/upload-artifact@v2
        with:
          name: extension
          path: dist/
```

---

## Checklist Before Release

- [ ] All TypeScript errors fixed: `npm run type-check`
- [ ] Production build created: `npm run build`
- [ ] dist/ folder contents verified
- [ ] Manifest version updated
- [ ] No console errors in popup/content/background
- [ ] All features tested in Chrome
- [ ] Extension icon and name set
- [ ] Permissions reviewed (manifest.json)
- [ ] DOM selectors verified (no changes to Slack UI)
- [ ] Data export/import tested
- [ ] Storage cleared between tests
- [ ] No hardcoded credentials or secrets
- [ ] README or documentation updated

---

## Build Artifacts Location

All build outputs go to: `dist/` folder

```
dist/
├── popup.js            (main React bundle)
├── popup.html          (popup template)
├── content.js          (content script)
├── background.js       (service worker)
├── manifest.json       (extension manifest)
└── vendor-[hash].js    (shared dependencies)
```

**This folder is ready to:**
- Load unpacked in Chrome
- Distribute to others
- Upload to Chrome Web Store

---

## Scripts Reference

| Script | Purpose | When to Use |
|--------|---------|------------|
| `npm run build` | Production build | Before release/distribution |
| `npm run dev` | Development with watch | During development |
| `npm run clean` | Remove dist folder | Before fresh build |
| `npm run type-check` | Check TypeScript types | Before commit/build |


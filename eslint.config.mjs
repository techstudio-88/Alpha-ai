import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  {ignores:["node_modules/**","worker/node_modules/**",".next/**",".*/**"]},
  {
    files:["app/page.jsx","app/layout.jsx","app/{error,global-error,loading}.jsx","app/auth/**/*.jsx","app/studio/*.jsx","app/design-system/*.jsx","app/api/workspace/**/*.js","app/api/google-drive/**/*.js","app/api/google-photos/**/*.js","app/api/publish/**/*.js","app/api/ai/chat/**/*.js","app/api/editor/**/*.js","app/api/auth/options/*.js","app/api/assistant/*.js","app/api/processing-jobs/**/*.js","app/api/cron/**/*.js","app/api/processing-status/*.js","components/studio/**/*.{jsx,js}","components/AIChatView.jsx","components/EditorView.jsx","components/BrowserTranscriber.jsx","lib/*.{js,mjs}","worker/*.{js,mjs}","workers/*.js","public/sw.js","tests/**/*.mjs"],
    languageOptions:{ecmaVersion:"latest",sourceType:"module",globals:{...globals.browser,...globals.node,...globals.worker},parserOptions:{ecmaFeatures:{jsx:true}}},
    plugins:{react},
    rules:{...js.configs.recommended.rules,"no-unused-vars":"off","no-empty":["error",{allowEmptyCatch:true}],"no-useless-escape":"off","react/jsx-no-undef":"error"}
  }
];

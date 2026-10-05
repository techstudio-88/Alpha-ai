import {defineConfig} from '@playwright/test';
const liveURL=process.env.ALPHA_TEST_BASE_URL;
export default defineConfig({
  testDir:'./tests/ui', timeout:30000, fullyParallel:true, workers:3,
  reporter:'list', outputDir:'/tmp/omnirush/alpha-ui-test-results',
  use:{baseURL:liveURL||'http://127.0.0.1:3100',browserName:'chromium',screenshot:'only-on-failure'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  webServer:liveURL?undefined:{command:'npm run start -- --hostname 127.0.0.1 --port 3100',url:'http://127.0.0.1:3100',timeout:30000,reuseExistingServer:false},
});

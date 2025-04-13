const WebSocket = require("ws");
const _ = require("lodash");
const net = require("net");
const { connect } = require("./lib/realbrowser/index.js");
const {
  startTrunstileServer,
  waitForTurnstileTaskResult,
} = require("./lib/fake-turnstile-server/index.js");
const { logger } = require("./lib/common/logger.js");

process.on("unhandledRejection", (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught Exception: ${error}`);
});

const realBrowserOption = {
  args: ["--start-maximized", "--ignore-certificate-errors"],
  turnstile: true,
  headless: false,
  // disableXvfb: true,
  customConfig: {},
  connectOption: {
    defaultViewport: null,
  },
  plugins: [],
  offScreen: true,
};

// Find a random available port
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

let trunstileServerPort;
let ws;

async function handleVercelCheckpointTask(task_data) {
  let browser;
  try {
    const { page_url, proxy_url } = task_data;
    const proxy = new URL(proxy_url);
    const connectResult = await connect({
      ...realBrowserOption,
      proxy: {
        host: proxy.hostname,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      },
    });
    browser = connectResult.browser;
    const page = connectResult.page;

    const captchaResult = {
      cookies: {},
      headers: {},
    };

    // 监听网络请求
    page.on("request", (request) => {
      const requestUrl = request.url();
      if (requestUrl.startsWith(page_url)) {
        const uaHeaders = {};
        for (const [key, value] of Object.entries(request.headers())) {
          if (
            key.toLowerCase() === "user-agent" ||
            key.toLowerCase().startsWith("sec-")
          ) {
            uaHeaders[key] = value;
          }
        }
        captchaResult.headers = {
          ...captchaResult.headers,
          ...(uaHeaders || {}),
        };
      }
    });

    await page.goto(page_url, { timeout: 120000 });

    const timeout = 90000;
    const startTime = Date.now();
    while (true) {
      try {
        const pageTitle = await page.title();
        logger.info(`Current page title: ${pageTitle}`);
        if (pageTitle != "Vercel Security Checkpoint") {
          break;
        }
      } catch (error) {
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (Date.now() - startTime > timeout) {
          throw new Error("Timeout");
        }
      }
    }

    // 获取 cookies 和请求头
    const cookies = await page.cookies();
    captchaResult.cookies = Object.fromEntries(
      cookies.map((cookie) => [cookie.name, cookie.value])
    );
    return captchaResult;
  } finally {
    try {
      await browser.close();
    } catch (error) {
      console.error(`Browser close error: ${error.message}`);
    }
  }
}

async function handleCloudflareChallengeTask(task_data) {
  let browser;
  try {
    const { page_url, proxy_url } = task_data;
    const proxy = new URL(proxy_url);
    const connectResult = await connect({
      ...realBrowserOption,
      proxy: {
        host: proxy.hostname,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      },
    });
    browser = connectResult.browser;
    const page = connectResult.page;

    const captchaResult = {
      cookies: {},
      headers: {},
    };

    // 监听网络请求
    page.on("request", (request) => {
      const requestUrl = request.url();
      if (requestUrl.startsWith(page_url)) {
        const uaHeaders = {};
        for (const [key, value] of Object.entries(request.headers())) {
          if (
            key.toLowerCase() === "user-agent" ||
            key.toLowerCase().startsWith("sec-")
          ) {
            uaHeaders[key] = value;
          }
        }
        captchaResult.headers = {
          ...captchaResult.headers,
          ...(uaHeaders || {}),
        };
      }
    });

    await page.goto(page_url, { timeout: 120000 });
    const timeout = 90000;
    const startTime = Date.now();
    while (true) {
      try {
        const cookies = await page.cookies();
        const cookiesDict = Object.fromEntries(
          cookies.map((cookie) => [cookie.name, cookie.value])
        );
        if (cookiesDict.hasOwnProperty("cf_clearance")) {
          break;
        }
      } catch (error) {
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (Date.now() - startTime > timeout) {
          throw new Error("Timeout");
        }
      }
    }

    // 获取 cookies 和请求头
    const cookies = await page.cookies();
    captchaResult.cookies = Object.fromEntries(
      cookies.map((cookie) => [cookie.name, cookie.value])
    );
    return captchaResult;
  } finally {
    try {
      await browser.close();
    } catch (error) {
      console.error(`Browser close error: ${error.message}`);
    }
  }
}

async function handleCloudflareTurnstileTask(task_id, task_data) {
  let browser;
  try {
    const { site_key, site_url, proxy_url } = task_data;
    const siteUrlObj = new URL(site_url);
    const siteHost = `https://${siteUrlObj.hostname}`;
    const fakeUrl = `${siteHost}/turnstile?sitekey=${site_key}&task_id=${task_id}`;
    logger.info(`🔑 Generated turnstile fake url: ${fakeUrl}`);
    let proxyOptions = {};
    if (proxy_url) {
      const proxy = new URL(proxy_url);
      proxyOptions = {
        host: proxy.hostname,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      };
    } else {
      proxyOptions = undefined;
    }
    const connectResult = await connect({
      ...realBrowserOption,
      proxy: proxyOptions,
    });
    browser = connectResult.browser;
    const page = connectResult.page;
    // 拦截所有请求
    await page.setRequestInterception(true);
    page.on("request", (interceptedRequest) => {
      const url = interceptedRequest.url();
      // 例如拦截 www.example.com 的请求
      if (url.includes(siteHost)) {
        interceptedRequest.continue({
          url: url.replace(
            siteHost,
            `https://localhost:${trunstileServerPort}`
          ),
        });
      } else {
        interceptedRequest.continue();
      }
    });
    await page.goto(fakeUrl, { timeout: 120000 });
    const result = await waitForTurnstileTaskResult(task_id, 120000);
    return result;
  } finally {
    try {
      await browser.close();
    } catch (error) {
      console.error(`Browser close error: ${error.message}`);
    }
  }
}

function connectWebSocket() {
  const webSocketUrl = "wss://capsolver.farmbot.me/ws";
  ws = new WebSocket(webSocketUrl, {
    timeout: 3000,
  });

  ws.on("open", () => {
    logger.info(`💡 Connected to WebSocket server: ${webSocketUrl}`);
  });

  ws.on("message", async (data) => {
    logger.info(`Received from server: ${data}`);

    const jobData = JSON.parse(data);
    const { task_id, task_type, task_data } = jobData;

    let result;

    try {
      if (task_type === "vercel_checkpoint") {
        result = await handleVercelCheckpointTask(task_data);
      } else if (task_type === "cloudflare_challenge") {
        result = await handleCloudflareChallengeTask(task_data);
      } else if (task_type === "cloudflare_turnstile") {
        result = await handleCloudflareTurnstileTask(task_id, task_data);
      } else {
        ws.send(
          JSON.stringify({
            event_type: "task_result",
            event_data: {
              task_id: task_id,
              success: false,
              error: "Unsupported task type",
            },
          })
        );
        return;
      }
    } catch (error) {
      logger.error(`❌ Task ${task_id} failed with error: ${error.message}`);
      ws.send(
        JSON.stringify({
          event_type: "task_result",
          event_data: {
            task_id: task_id,
            success: false,
            error: error.message,
          },
        })
      );
      return;
    }

    logger.info(
      `🎉 Task ${task_id} completed successfully with result: ${JSON.stringify(
        result
      )}`
    );
    ws.send(
      JSON.stringify({
        event_type: "task_result",
        event_data: {
          task_id: task_id,
          success: true,
          result: result,
        },
      })
    );
  });

  ws.on("close", () => {
    logger.info("💔 Disconnected from server, attempting to reconnect...");
    setTimeout(connectWebSocket, 1000);
  });

  ws.on("error", (error) => {
    logger.error(`❌ WebSocket error: ${error.message}`);
  });
}

// Initialize and start the server
async function initialize() {
  try {
    // Get a random available port
    trunstileServerPort = await getAvailablePort();
    logger.info(`🚀 Using port ${trunstileServerPort} for Turnstile server`);

    // Start the turnstile server with the random port
    startTrunstileServer(trunstileServerPort);

    // Connect to WebSocket
    connectWebSocket();
  } catch (error) {
    logger.error(`Initialization error: ${error.message}`);
    process.exit(1);
  }
}

// Start the application
initialize();

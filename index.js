const WebSocket = require("ws");
const _ = require("lodash");
const { connect } = require("./lib/cjs/index.js");
const winston = require("winston");

process.on("unhandledRejection", (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
});

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught Exception: ${error}`);
});

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "capsolver-worker" },
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});
logger.add(
  new winston.transports.Console({
    format: winston.format.printf(({ level, message, timestamp }) => {
      const fixedLengthTimestamp = timestamp.padEnd(24, " ");
      const fixedLengthLevel = level
        .toUpperCase()
        .padStart((6 + level.length) / 2, " ")
        .padEnd(6, " ");
      return `${fixedLengthTimestamp} [${fixedLengthLevel}]: ${message}`;
    }),
  })
);

const realBrowserOption = {
  args: ["--start-maximized"],
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

function connectWebSocket() {
  ws = new WebSocket("wss://capsolver.farmbot.me/ws", {
    timeout: 3000,
  });

  ws.on("open", () => {
    logger.info("💡 Connected to WebSocket server");
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

connectWebSocket();
